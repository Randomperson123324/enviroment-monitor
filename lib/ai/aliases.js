/**
 * Pseudonymisation for anything leaving this machine.
 *
 * A real name is not a measurement. "ปุณณ์ ขยับ 12 ครั้ง/นาที" and
 * "{{NAME_1}} ขยับ 12 ครั้ง/นาที" ask a cloud model exactly the same question,
 * and only one of them tells Google who was in the room — so every identifier is
 * swapped for a variable on the way out and swapped back on the way in. The user
 * reads real names; the provider never sees one.
 *
 * ── Dynamic by construction ──────────────────────────────────────────────────
 * Nothing here knows a single name. The map is built at request time from two
 * sources: identifier-shaped **fields** in whatever payload is being sent (see
 * config.ai.aliases.fields), and a **roster** read from the live data, which is
 * what lets a name typed into the chat box — "ปุณณ์ ตั้งใจเรียนไหม" — be masked
 * too. Add a photo to the faces/ folder and that person is covered on the next
 * request; nothing in this file changes.
 *
 * ── Which providers ──────────────────────────────────────────────────────────
 * Everything not on `config.ai.focusProviders` — the list that already means
 * "may hold raw identities". Deriving it from that list rather than naming
 * Gemini here means a provider added later is masked by default: the failure
 * mode of forgetting is privacy, not a leak.
 *
 * ⚠️ Masking is not a licence to send camera data to the cloud. The `local_only`
 * gate in lib/ai/tools.js is unchanged and still refuses. This layer protects
 * the paths where an identifier can legitimately travel — the user's own words,
 * device ids, a summary — not the camera feed.
 */
import config from '@/config';
import { MSG } from '@/config/messages.th';
import { selectRows } from '@/lib/supabase';
import { listDevices } from '@/lib/dashboard';

/** `{{KIND_N}}` — braces because every model already reads them as a placeholder. */
const TOKEN = /\{\{([A-Z][A-Z0-9]*)_(\d+)\}\}/g;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Which kind of identifier a field holds, or null for "not an identifier". */
function kindOfField(key) {
  const rule = config.ai.aliases.fields.find((f) => new RegExp(f.match, 'i').test(key));
  return rule?.kind ?? null;
}

/**
 * Is this value safe to hunt for inside free text?
 *
 * Structural masking replaces a *field's* value and can take anything, but text
 * masking searches for the value everywhere — so a person whose track id is `2`
 * would turn every "2" in the conversation into a token, including the ones in
 * "PM2.5" and "2 ชั่วโมง". Short and purely numeric identifiers are therefore
 * still mapped (so the model's answer round-trips) but never hunted for.
 */
function searchable(value) {
  const s = String(value);
  return s.length >= config.ai.aliases.minTextLength && !/^\d+$/.test(s);
}

/** Distinct identifiers currently live in the system, cached briefly. */
let rosterCache = { at: 0, entries: [] };

/**
 * Who and what exists right now: recognised names from the camera table, device
 * ids from the sensor table. Best effort throughout — a roster we could not read
 * costs coverage of names typed in free text, and must never cost the user their
 * answer.
 */
async function loadRoster() {
  const { rosterTtlMs, rosterRows } = config.ai.aliases;
  if (Date.now() - rosterCache.at < rosterTtlMs) return rosterCache.entries;

  const [rows, devices] = await Promise.all([
    selectRows(config.supabase.focusTable, {
      select: 'name',
      order: 'created_at.desc',
      limit: String(rosterRows),
    }).catch(() => []),
    listDevices().catch(() => []),
  ]);

  const entries = [];
  const seen = new Set();
  const add = (value, kind) => {
    if (typeof value !== 'string' || !value.trim() || seen.has(value)) return;
    seen.add(value);
    entries.push({ value, kind });
  };
  for (const d of devices) add(typeof d === 'string' ? d : d?.device_id, 'DEVICE');
  for (const r of rows) add(r?.name, 'NAME');

  rosterCache = { at: Date.now(), entries };
  return entries;
}

/**
 * One request's mapping. Tokens are stable within a request and meaningless
 * outside it: nothing is persisted, so the same person is `{{NAME_1}}` in one
 * turn and `{{NAME_2}}` in the next if someone else came first. That is the
 * point — a map that survived requests would itself become a record of who was
 * in the room.
 */
function newSession() {
  const byReal = new Map(); // lowercased real value → token
  const byToken = new Map(); // token → real value, as first seen
  const counts = new Map(); // kind → how many issued
  /** Values worth hunting for in prose, longest first so a name containing
      another name masks whole instead of leaving a fragment behind. */
  const textual = [];

  function tokenFor(kind, real) {
    if (real == null || real === '') return real;
    const value = String(real);
    const seen = byReal.get(value.toLowerCase());
    if (seen) return seen;

    const n = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, n);
    const token = `{{${kind}_${n}}}`;
    byReal.set(value.toLowerCase(), token);
    byToken.set(token, value);
    if (searchable(value)) {
      textual.push({ value, token });
      textual.sort((a, b) => b.value.length - a.value.length);
    }
    return token;
  }

  function maskText(text) {
    let out = String(text ?? '');
    for (const { value, token } of textual) {
      out = out.replace(new RegExp(escapeRe(value), 'gi'), token);
    }
    return out;
  }

  /** Deep-mask a payload: identifier fields become tokens, prose gets scanned. */
  function mask(value) {
    if (value == null) return value;
    if (typeof value === 'string') return maskText(value);
    if (Array.isArray(value)) return value.map(mask);
    if (typeof value !== 'object') return value;

    const out = {};
    for (const [key, v] of Object.entries(value)) {
      const kind = kindOfField(key);
      // An identifier field is replaced whatever it holds — including the bare
      // numbers a track id arrives as, which text masking must never touch.
      if (kind && (typeof v === 'string' || typeof v === 'number')) out[key] = tokenFor(kind, v);
      else out[key] = mask(v);
    }
    return out;
  }

  /** Unknown tokens are left alone: inventing a mapping is worse than showing one. */
  function unmask(text) {
    return String(text ?? '').replace(TOKEN, (tok) => byToken.get(tok) ?? tok);
  }

  function unmaskDeep(value) {
    if (typeof value === 'string') return unmask(value);
    if (Array.isArray(value)) return value.map(unmaskDeep);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unmaskDeep(v)]));
    }
    return value;
  }

  /**
   * Chunk-safe unmasking for a streamed answer.
   *
   * A token arrives split across deltas more often than not — `{{NA` in one
   * chunk and `ME_1}}` in the next — and a per-chunk replace would ship the raw
   * placeholder to the screen and then never match the remainder. So everything
   * from an unclosed `{{` onward is held back until it completes.
   */
  function streamUnmasker() {
    let buf = '';
    return {
      push(chunk) {
        buf += chunk ?? '';
        let hold = '';
        const open = buf.lastIndexOf('{{');
        if (open !== -1 && !buf.slice(open).includes('}}')) {
          hold = buf.slice(open);
          buf = buf.slice(0, open);
        } else if (buf.endsWith('{')) {
          // A lone brace could be the first half of the next token's `{{`.
          hold = '{';
          buf = buf.slice(0, -1);
        }
        const out = unmask(buf);
        buf = hold;
        return out;
      },
      flush() {
        const out = unmask(buf);
        buf = '';
        return out;
      },
    };
  }

  return {
    tokenFor,
    mask,
    maskText,
    unmask,
    unmaskDeep,
    streamUnmasker,
    /** Told to the model, so it echoes tokens back instead of "helpfully" naming them. */
    note: () => MSG.aliases.note,
    get size() {
      return byToken.size;
    },
    async learnRoster() {
      try {
        for (const { value, kind } of await loadRoster()) tokenFor(kind, value);
      } catch (err) {
        console.warn('[ai/aliases] roster unavailable:', err.message);
      }
    },
  };
}

/** Does this provider get pseudonymised data? */
export function aliasesNeeded(provider) {
  return config.ai.aliases.enabled && !config.ai.focusProviders.includes(provider);
}

/**
 * A mapping for one request, or `null` when the provider is trusted with real
 * identities. Callers branch on null rather than paying for a no-op session.
 */
export async function createAliasSession(provider) {
  if (!aliasesNeeded(provider)) return null;
  const session = newSession();
  await session.learnRoster();
  return session;
}

/** Prepend the format rules to whatever the caller was already telling the model. */
export function withAliasNote(session, systemInstruction) {
  if (!session) return systemInstruction;
  return [session.note(), systemInstruction].filter(Boolean).join('\n\n');
}
