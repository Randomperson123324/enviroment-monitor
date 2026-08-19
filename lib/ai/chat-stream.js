/**
 * Streaming chat with tools — one loop for both providers.
 *
 * The shape is model → tool calls → results → model, repeated until the model
 * answers with text instead of another call. Each provider yields the same
 * normalized events (see lib/ai/providers/*), so the only provider-specific code
 * here is how a tool result is appended to the transcript: Gemini wants
 * functionResponse parts, an OpenAI-compatible endpoint wants role:'tool'
 * messages. Everything else — the bounds, the ordering, the fallback — is shared.
 *
 * ── Bounds, and why each exists ──────────────────────────────────────────────
 * `maxRounds`  a model that misreads a tool result can ask for it forever
 * `maxCalls`   one round can contain many calls; rounds alone do not bound cost
 * `budgetMs`   a streamed turn holds an HTTP connection open, so it needs a
 *              wall clock of its own rather than inheriting the chain's
 *
 * ── Provider fallback ────────────────────────────────────────────────────────
 * If a provider fails *before* producing any output, the next one is tried. Once
 * text has reached the user, a failure is reported as an error event instead:
 * restarting mid-answer would rewrite what someone is already reading.
 */
import config from '@/config';
import { MSG } from '@/config/messages.th';
import { PROVIDERS, providerOrder, providerReady, providerSettings, resolveModel } from '@/lib/ai/discovery';
import { mayReadFocus, readsFocusMasked, runTool, toolsFor } from '@/lib/ai/tools';
import { createAliasSession, withAliasNote } from '@/lib/ai/aliases';

/**
 * What the model is told about itself.
 *
 * The camera line is three-way, and each branch exists for a failure of its own:
 * a model with no camera tool, asked about focus, reaches for the nearest
 * plausible thing — the sensor data — and answers as though it had looked, so
 * the limit is named; a model reading that data as `{{NAME_1}}` variables will
 * otherwise report the placeholders as corrupt data or try to guess who they
 * are, so it is told what they are; and one holding real names needs neither.
 */
function systemPrompt(provider, { search, hasTools }) {
  const lines = [MSG.chat.toolContext];

  // Tools off is a kill switch, not a normal state — but a model told to "call a
  // tool before answering" while holding none would invent the data instead.
  if (!hasTools) {
    lines.push(MSG.chat.noTools);
    return lines.join('\n');
  }

  if (!mayReadFocus(provider)) lines.push(MSG.chat.noFocusAccess);
  else if (readsFocusMasked(provider)) lines.push(MSG.chat.maskedFocusAccess);
  else lines.push(MSG.chat.hasFocusAccess);

  lines.push(search ? MSG.chat.searchOn : MSG.chat.searchOff);
  return lines.join('\n');
}

/** Transcript seeds, per provider dialect. */
function initialTurns(provider, history, message) {
  const turns = history.slice(-config.ai.maxHistoryTurns).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content ?? ''),
  }));
  const all = [...turns, { role: 'user', content: message }];

  if (provider === 'gemini') {
    return all.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
  }
  return all;
}

/** Append the model's tool calls + their results, in that provider's dialect. */
function appendToolRound(provider, transcript, calls, results) {
  if (provider === 'gemini') {
    transcript.push({
      role: 'model',
      parts: calls.map((c) => ({
        functionCall: { name: c.name, args: c.args },
        // Must be echoed back exactly as received — see the provider. Rebuilding
        // the model's turn from name and args alone is what dropped it.
        ...(c.thoughtSignature ? { thoughtSignature: c.thoughtSignature } : {}),
      })),
    });
    transcript.push({
      role: 'user',
      parts: results.map((r) => ({
        functionResponse: { name: r.name, response: { result: r.result } },
      })),
    });
    return;
  }
  transcript.push({
    role: 'assistant',
    content: null,
    tool_calls: calls.map((c) => ({
      id: c.id,
      type: 'function',
      function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
    })),
  });
  for (const r of results) {
    transcript.push({ role: 'tool', tool_call_id: r.id, content: JSON.stringify(r.result) });
  }
}

async function* streamOne(id, { message, history, deviceId, lang, search, thinking, overrides, deadline }) {
  const s = providerSettings(id, overrides);
  const left = () => deadline - Date.now();
  const model = await resolveModel(id, overrides, { timeoutMs: Math.min(s.timeoutMs, left()) });
  const tools = config.ai.tools.enabled ? toolsFor(id, { search }) : [];

  /**
   * Identifiers are pseudonymised for any provider off this machine — see
   * lib/ai/aliases.js. Three directions have to be kept straight here, and
   * getting one backwards is either a leak or a broken answer:
   *   out   the transcript and every tool result the model reads
   *   in    the answer text, restored before it reaches the screen
   *   back  tool arguments the model wrote, which arrive holding tokens and
   *         must be turned back into real values before a tool runs on them
   * Events for the UI keep real values throughout: the browser is where the
   * data already lives, so masking there would only hide it from its owner.
   */
  const alias = await createAliasSession(id);
  const maskText = (v) => (alias ? alias.maskText(v) : v);
  const real = (v) => (alias ? alias.unmaskDeep(v) : v);

  const transcript = initialTurns(
    id,
    history.map((m) => ({ ...m, content: maskText(m.content) })),
    maskText(message)
  );

  yield { type: 'start', provider: id, model, tools: tools.map((t) => t.name) };

  let calls = 0;
  for (let round = 0; round < config.ai.tools.maxRounds; round++) {
    const pending = [];

    const common = {
      baseUrl: s.baseUrl,
      apiKey: s.apiKey,
      model,
      systemInstruction: withAliasNote(alias, systemPrompt(id, { search, hasTools: tools.length > 0 })),
      tools,
      thinking,
      thinkingLevel: s.thinkingLevel,
      timeoutMs: Math.max(1000, Math.min(s.timeoutMs, left())),
      // Reasoning is counted as output: on the same budget as a plain turn the
      // model can think its way to MAX_TOKENS and never start the answer.
      maxTokens: thinking && s.thinkingMaxTokens ? Math.max(s.maxTokens, s.thinkingMaxTokens) : s.maxTokens,
    };
    const stream =
      id === 'gemini'
        ? PROVIDERS.gemini.impl.streamGenerate({ ...common, contents: transcript })
        : PROVIDERS[id].impl.streamGenerate({ ...common, messages: transcript });

    // Held across the whole provider stream: a token is routinely split between
    // two deltas, so the unmasker keeps the tail until it can be resolved.
    const restore = alias ? alias.streamUnmasker() : null;

    for await (const ev of stream) {
      if (ev.type === 'call') {
        // Over the ceiling: tell the model so, rather than silently ignoring the
        // call and leaving it waiting for a result that never comes.
        if (calls >= config.ai.tools.maxCalls) {
          pending.push({ ...ev, refused: true });
          continue;
        }
        calls++;
        pending.push(ev);
        continue;
      }
      if (restore && ev.type === 'delta') {
        const text = restore.push(ev.text);
        if (text) yield { ...ev, text };
        continue;
      }
      yield ev;
    }

    if (restore) {
      const tail = restore.flush();
      if (tail) yield { type: 'delta', text: tail };
    }

    if (!pending.length) return;

    // Announce before running, not after: a tool can take seconds, and this is
    // the event that tells the user the assistant is fetching rather than stuck.
    for (const c of pending) yield { type: 'tool-start', name: c.name, args: real(c.args) };

    // Run this round's calls together: they are independent reads, and asking
    // for the room and the rainfall one after the other doubles the wait.
    const results = await Promise.all(
      pending.map(async (c) => {
        const result = c.refused
          ? { error: `เรียกเครื่องมือเกิน ${config.ai.tools.maxCalls} ครั้งในหนึ่งคำถาม` }
          // A model that was handed {{NAME_1}} will ask for {{NAME_1}} back —
          // the tool has to receive what the database actually stores.
          : await runTool(c.name, real(c.args), { provider: id, deviceId, lang });
        return { id: c.id, name: c.name, args: c.args, result };
      })
    );

    for (const r of results) {
      yield { type: 'tool', name: r.name, args: real(r.args), ok: !r.result?.error, note: r.result?.error ?? null };
    }

    appendToolRound(
      id,
      transcript,
      pending,
      alias ? results.map((r) => ({ ...r, result: alias.mask(r.result) })) : results
    );

    if (left() < 2000) {
      yield { type: 'error', message: MSG.chat.streamBudget };
      return;
    }
  }

  yield { type: 'error', message: MSG.chat.tooManyRounds };
}

/**
 * Stream one chat turn. Yields normalized events; the route serializes them.
 * Throws only when no provider could even be started.
 */
export async function* chatStream({
  message,
  history = [],
  deviceId,
  lang = 'th',
  search = false,
  thinking = false,
  overrides = {},
}) {
  const order = providerOrder(overrides).filter((id) => providerReady(id, overrides));
  if (!order.length) throw new Error('no AI provider configured');

  const deadline = Date.now() + config.ai.stream.budgetMs;
  const errors = [];

  for (const id of order) {
    let produced = false;
    try {
      for await (const ev of streamOne(id, {
        message, history, deviceId, lang, search, thinking, overrides, deadline,
      })) {
        if (ev.type === 'delta' || ev.type === 'tool') produced = true;
        yield ev;
      }
      return;
    } catch (err) {
      console.warn(`[ai/stream] ${id} failed:`, err.message);
      errors.push(`${id}: ${err.message}`);
      // Past the point of no return: the user is reading an answer from this
      // provider, so finish honestly instead of starting a different one.
      if (produced) {
        yield { type: 'error', message: err.message };
        return;
      }
    }
  }
  throw new Error(errors.join(' · '));
}
