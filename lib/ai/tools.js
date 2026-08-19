/**
 * Tools the assistant can call, instead of the app deciding in advance what to
 * paste into the prompt.
 *
 * Why this replaced the attached context line: every chat turn used to carry one
 * pre-rendered sentence of the latest reading, which meant the model could only
 * answer questions about that sentence. Asked about last night's humidity, the
 * rainfall upstream, or which disease risk is raised, it had to guess or decline
 * — the data existed, one HTTP call away, but nothing could ask for it. Now the
 * model asks, and the prompt carries no data at all until it does.
 *
 * ── Who may see what ─────────────────────────────────────────────────────────
 * Camera data (`camera_data` below) is the one domain with a gate on it, and
 * the gate has two settings rather than one:
 *   • providers on `config.ai.focusProviders` read it as it is stored, names
 *     and all — the on-device engines, which send nothing anywhere;
 *   • everyone else reads it only pseudonymised, and only while
 *     `config.ai.focusViaAlias` and the alias layer are both on. Every name and
 *     device id is a `{{NAME_1}}` variable by the time it leaves the process
 *     (lib/ai/aliases.js), and the answer comes back through the reverse map, so
 *     the user reads real names and the provider never saw one.
 *
 * Whichever setting applies, it is enforced in three places on purpose, because
 * one place is one mistake away from a leak:
 *   1. `toolsFor(provider)` never offers the camera tools to a provider that may
 *      not read them — the model cannot call what it cannot see.
 *   2. The system instruction tells that model what it has, so it either uses
 *      the variables properly or says plainly that it has no camera access,
 *      instead of inventing numbers to fill the gap.
 *   3. `runTool()` re-checks the provider before touching the database, so a
 *      hallucinated call to a tool that was never offered returns a refusal
 *      rather than rows.
 * (3) is what makes the guarantee real: (1) and (2) shape what the model is
 * likely to do, and only (3) decides what actually happens.
 */
import config from '@/config';
import { SENSORS } from '@/config/sensors';
import { aliasesNeeded } from '@/lib/ai/aliases';
import { translate } from '@/config/i18n';
import { getLatest, getHistory, normalizeDeviceId, clampHours } from '@/lib/dashboard';
import { readingSummary, healthScore, analyzeReading } from '@/lib/analysis';
import { assessDiseases } from '@/lib/disease';
import { selectRows } from '@/lib/supabase';
import { webSearch, searchConfigured } from '@/lib/ai/search';
import { analyzeCorrelation, movementCount } from '@/lib/correlate';

const round = (n, d = 1) => (Number.isFinite(n) ? Number(n.toFixed(d)) : null);

/** Reject null/'' before Number(): `Number(null)` is 0, which reads as a real measurement. */
const has = (v) => v != null && v !== '';

/** min / max / avg of one column, gaps excluded. */
function spread(rows, key) {
  const vals = rows.filter((r) => has(r[key])).map((r) => Number(r[key])).filter(Number.isFinite);
  if (!vals.length) return null;
  const sum = vals.reduce((a, v) => a + v, 0);
  return {
    min: round(Math.min(...vals)),
    max: round(Math.max(...vals)),
    avg: round(sum / vals.length),
    samples: vals.length,
  };
}

/** ISO timestamp `hours` ago — the left edge of a look-back window. */
function sinceIso(hours) {
  return new Date(Date.now() - hours * 3600000).toISOString();
}

/**
 * Tool definitions.
 *
 * `parameters` is JSON Schema, which both providers accept (Gemini calls it
 * functionDeclarations, OpenAI-compatible endpoints call it tools) — see
 * lib/ai/providers/*. `camera_data` marks a tool whose output is derived from
 * the camera, and so is subject to the gate at the top of this file.
 */
export const TOOLS = [
  {
    name: 'get_sensor_latest',
    description:
      'อ่านค่าเซ็นเซอร์ล่าสุดของห้อง (อุณหภูมิ ความชื้น PM1/PM2.5/PM10) พร้อมคะแนนสุขภาพห้องและข้อสังเกต ' +
      'ใช้เมื่อผู้ใช้ถามถึงสภาพห้อง "ตอนนี้"',
    parameters: {
      type: 'object',
      properties: {
        device_id: { type: 'string', description: 'รหัสอุปกรณ์ เว้นว่างเพื่อใช้ตัวที่ผู้ใช้เลือกอยู่' },
      },
    },
    async run({ device_id }, ctx) {
      const reading = await getLatest(normalizeDeviceId(device_id) ?? ctx.deviceId);
      if (!reading) return { available: false, reason: 'ยังไม่มีข้อมูลเซ็นเซอร์ในระบบ' };
      const { issues, recommendations } = analyzeReading(reading);
      return {
        measured_at: reading.created_at ?? null,
        device_id: reading.device_id ?? null,
        values: Object.fromEntries(
          SENSORS.map((s) => [s.field, has(reading[s.field]) ? Number(reading[s.field]) : null])
        ),
        units: Object.fromEntries(SENSORS.map((s) => [s.field, s.unit])),
        health_score: healthScore(reading),
        summary: readingSummary(reading),
        issues,
        recommendations,
      };
    },
  },

  {
    name: 'get_sensor_history',
    description:
      'สรุปค่าเซ็นเซอร์ย้อนหลัง: ต่ำสุด/สูงสุด/เฉลี่ย ของแต่ละค่าในช่วงกี่ชั่วโมงที่ระบุ ' +
      'ใช้เมื่อผู้ใช้ถามถึงแนวโน้ม การเปลี่ยนแปลง เมื่อคืน เมื่อวาน หรือช่วงเวลาใด ๆ ที่ผ่านมา',
    parameters: {
      type: 'object',
      properties: {
        hours: { type: 'number', description: 'ย้อนหลังกี่ชั่วโมง (ค่าเริ่มต้น 24)' },
        device_id: { type: 'string' },
      },
    },
    async run({ hours, device_id }, ctx) {
      const window = clampHours(hours ?? config.api.defaultHours);
      const rows = await getHistory({
        deviceId: normalizeDeviceId(device_id) ?? ctx.deviceId,
        hours: window,
        limit: config.api.defaultHistoryLimit,
      });
      if (!rows.length) return { available: false, hours: window, reason: 'ไม่มีข้อมูลในช่วงเวลานี้' };
      return {
        hours: window,
        rows: rows.length,
        from: rows[0]?.created_at ?? null,
        to: rows[rows.length - 1]?.created_at ?? null,
        trend: Object.fromEntries(
          SENSORS.map((s) => [s.field, spread(rows, s.field)]).filter(([, v]) => v)
        ),
      };
    },
  },

  {
    name: 'get_health_risks',
    description:
      'ความเสี่ยงด้านสุขภาพที่ประเมินจากสภาพห้องล่าสุด (เช่น ไข้เลือดออก โรคทางเดินหายใจ ไรฝุ่น เชื้อรา) ' +
      'พร้อมระดับความเสี่ยงและเหตุผลจากค่าเซ็นเซอร์',
    parameters: {
      type: 'object',
      properties: { device_id: { type: 'string' } },
    },
    async run({ device_id }, ctx) {
      const reading = await getLatest(normalizeDeviceId(device_id) ?? ctx.deviceId);
      const { risks } = assessDiseases(reading);
      if (!risks.length) {
        return { available: false, reason: 'ยังประเมินไม่ได้ — ไม่มีค่าเซ็นเซอร์ที่เกี่ยวข้อง' };
      }
      return {
        based_on: reading ? readingSummary(reading) : null,
        risks: risks.map((d) => ({
          disease: translate(ctx.lang ?? 'th', d.nameKey),
          level: d.level,
          because: (d.reasonKeys ?? []).map((k) => translate(ctx.lang ?? 'th', k)),
        })),
      };
    },
  },

  {
    name: 'get_focus_activity',
    // The description doubles as the reason a cloud model is told it lacks this,
    // on a deployment where it does.
    description:
      'ข้อมูลการมีส่วนร่วมในห้องเรียนจากกล้อง (pi-vision): การขยับ/หันหน้าต่อคน ทิศทาง และจำนวนคนที่ตรวจพบ ' +
      'เป็นข้อมูลจากกล้อง จึงถูกจำกัดสิทธิ์การเข้าถึง และชื่อคนอาจมาในรูปตัวแปรแทนชื่อจริง',
    camera_data: true,
    parameters: {
      type: 'object',
      properties: {
        rows: { type: 'number', description: 'จำนวนแถวล่าสุดที่จะดู (ค่าเริ่มต้นตามการตั้งค่า)' },
      },
    },
    async run({ rows: want }) {
      const limit = Math.min(
        Math.max(Number(want) || config.ai.summary.focusRows, 1),
        config.ai.summary.focusRows
      );
      const rows = await selectRows(config.supabase.focusTable, {
        order: 'created_at.desc',
        limit: String(limit),
      });
      if (!rows.length) return { available: false, reason: 'ยังไม่มีข้อมูลจากกล้อง' };

      // Aggregates only. Raw frames never enter the context, even on-device:
      // the question is always "how much movement", never "what did they do".
      const byPerson = new Map();
      for (const r of rows) {
        const id = r.name ?? r.person ?? 'unknown';
        if (!byPerson.has(id)) byPerson.set(id, { moves: 0, samples: 0, dirs: new Map() });
        const p = byPerson.get(id);
        p.moves += movementCount(r.movement);
        p.samples++;
        if (r.direction) {
          const dirs = typeof r.direction === 'object' ? Object.keys(r.direction) : [r.direction];
          for (const d of dirs) p.dirs.set(d, (p.dirs.get(d) ?? 0) + 1);
        }
      }
      const times = rows.map((r) => Date.parse(r.created_at)).filter(Number.isFinite);
      const spanMin = times.length
        ? Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 60000))
        : 0;

      return {
        rows: rows.length,
        span_minutes: spanMin,
        people: [...byPerson.entries()]
          .sort((a, b) => b[1].moves - a[1].moves)
          .map(([id, p]) => ({
            person: id,
            movements: p.moves,
            per_minute: spanMin ? round(p.moves / spanMin, 2) : null,
            samples: p.samples,
            directions: Object.fromEntries(p.dirs),
          })),
      };
    },
  },

  {
    name: 'analyze_correlation',
    // Named for the question rather than the statistic: the model has to
    // recognise this tool from "ช่วงที่ CO₂ สูงขึ้น ห้องเงียบลงไหม", which is how
    // the question always arrives — nobody asks for a Pearson coefficient.
    description:
      'หาความสัมพันธ์ระหว่างค่าเซ็นเซอร์กับพฤติกรรมของคนในห้องจากกล้อง โดยจับคู่ข้อมูลสองชุดตามช่วงเวลาเดียวกัน ' +
      'ใช้เมื่อผู้ใช้ถามว่าค่าหนึ่งกระทบอีกค่าหนึ่งไหม เช่น "ช่วงที่ CO₂ สูงขึ้น การมีส่วนร่วมของห้องลดลงหรือไม่" ' +
      '"อากาศร้อนแล้วคนมีส่วนร่วมน้อยลงไหม" "ฝุ่นเยอะมีผลกับความตั้งใจไหม" ' +
      'คืนค่าสหสัมพันธ์ (r) พร้อมจำนวนช่วงเวลาที่ใช้คำนวณ และการเทียบ "ช่วงที่ค่าสูง vs ช่วงที่ค่าต่ำ" ตรง ๆ ' +
      '⚠️ ตัวชี้วัดฝั่งกล้องคือ "จำนวนครั้งที่หันหน้าออกจากท่านิ่งต่อคนต่อนาที" ซึ่ง**ยิ่งสูงยิ่งมีส่วนร่วมน้อย** ' +
      'ต้องอ่านทิศทางตามที่เครื่องมือบอก ห้ามสลับเอง',
    // Same gate as get_focus_activity: the output is derived from camera rows,
    // so aggregating it does not make it less camera data.
    camera_data: true,
    parameters: {
      type: 'object',
      properties: {
        hours: { type: 'number', description: 'ย้อนหลังกี่ชั่วโมง (ค่าเริ่มต้น 24)' },
        sensor: {
          type: 'string',
          description:
            'ดูเฉพาะเซ็นเซอร์ตัวเดียว เช่น co2 · temp · pm25 — เว้นว่างเพื่อดูทุกตัวที่มีข้อมูล',
        },
        device_id: { type: 'string' },
      },
    },
    async run({ hours, sensor, device_id }, ctx) {
      const cfg = config.ai.correlate;
      const window = clampHours(hours ?? cfg.defaultHours);

      // Match the short id as well as the column name: the id is what the UI and
      // the thresholds call it ("temp", "hum") while the database column is
      // `temperature` / `humidity`. A model asked about temperature will say
      // "temp", and rejecting that would be rejecting the right question over a
      // naming detail it has no way to know.
      //
      // A name that matches nothing must not silently widen to "all sensors",
      // or the answer describes something the user never asked about.
      const wanted = String(sensor ?? '').trim().toLowerCase();
      const fields = wanted
        ? SENSORS.filter(
            (s) => s.field.toLowerCase() === wanted || s.id.toLowerCase() === wanted
          ).map((s) => s.field)
        : SENSORS.map((s) => s.field);
      if (wanted && !fields.length) {
        return {
          available: false,
          reason:
            `ไม่รู้จักเซ็นเซอร์ชื่อ "${sensor}" — มีให้เลือก: ` +
            SENSORS.map((s) => s.id).join(', '),
        };
      }

      const since = sinceIso(window);
      const [envRows, focusRows] = await Promise.all([
        getHistory({
          deviceId: normalizeDeviceId(device_id) ?? ctx.deviceId,
          hours: window,
          limit: cfg.envLimit,
        }),
        selectRows(config.supabase.focusTable, {
          created_at: `gte.${since}`,
          order: 'created_at.desc',
          limit: String(cfg.focusLimit),
        }),
      ]);

      if (!envRows.length || !focusRows.length) {
        return {
          available: false,
          hours: window,
          reason: !envRows.length
            ? 'ไม่มีค่าเซ็นเซอร์ในช่วงเวลานี้'
            : 'ไม่มีข้อมูลจากกล้องในช่วงเวลานี้',
        };
      }

      return analyzeCorrelation({
        envRows,
        focusRows,
        fields,
        metrics: ['turns_per_person_per_min', 'people'],
        hours: window,
        units: Object.fromEntries(SENSORS.map((s) => [s.field, s.unit])),
        cfg: { ...cfg, attentionThreshold: config.client.focus.thresholdDefault },
      });
    },
  },

  {
    name: 'web_search',
    description:
      'ค้นหาข้อมูลจากอินเทอร์เน็ต ใช้เมื่อคำถามต้องการข้อมูลที่ไม่ได้อยู่ในระบบนี้ ' +
      'เช่น ค่ามาตรฐาน ข่าว พยากรณ์อากาศ หรือความรู้ทั่วไปที่ควรอ้างอิงแหล่งที่มา',
    needs_search: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'คำค้น' },
      },
      required: ['query'],
    },
    async run({ query }) {
      if (!String(query ?? '').trim()) return { available: false, reason: 'ไม่มีคำค้น' };
      return webSearch(String(query));
    },
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/**
 * Is this provider allowed to hold camera data at all?
 *
 * Two ways to qualify, and the second is conditional on the masking actually
 * being in force: `aliasesNeeded()` is false when the alias layer is switched
 * off, which turns this back into a plain refusal rather than a promise nothing
 * is keeping. The unsafe combination — cloud access with the masking disabled —
 * cannot be expressed here at all.
 */
export function mayReadFocus(provider) {
  if (config.ai.focusProviders.includes(provider)) return true;
  return config.ai.focusViaAlias && aliasesNeeded(provider);
}

/** …and does it get that data as variables rather than as names? */
export function readsFocusMasked(provider) {
  return !config.ai.focusProviders.includes(provider) && mayReadFocus(provider);
}

/**
 * The tools a given provider may be offered this turn.
 * `search` follows the user's toggle — an unasked-for web call is a surprise,
 * and on a metered key it is a surprise that costs money.
 */
export function toolsFor(provider, { search = false } = {}) {
  return TOOLS.filter((t) => {
    if (t.camera_data && !mayReadFocus(provider)) return false;
    if (t.needs_search && !(search && searchConfigured())) return false;
    return true;
  });
}

/**
 * Run one tool call. Returns a plain object destined for the model — including
 * for refusals and failures, because "this tool is not available to you" and
 * "this tool broke" are both answers the model must be able to relay.
 */
export async function runTool(name, args, ctx = {}) {
  const tool = BY_NAME.get(name);
  if (!tool) return { error: `ไม่มีเครื่องมือชื่อ "${name}"` };

  // Independent of what was offered: a model may name a tool it was never given.
  if (tool.camera_data && !mayReadFocus(ctx.provider)) {
    return {
      error: 'ไม่มีสิทธิ์เข้าถึงข้อมูลกล้องจากผู้ให้บริการนี้',
      why: 'ข้อมูลกล้องถูกจำกัดให้ประมวลผลด้วย AI ในเครื่องเท่านั้น จึงไม่ถูกส่งออกไปยังบริการภายนอก',
      tell_user: true,
    };
  }
  if (tool.needs_search && !searchConfigured()) {
    return { error: 'ยังไม่ได้ตั้งค่าการค้นหาเว็บ (ไม่มี TAVILY_API_KEY)', tell_user: true };
  }

  try {
    return await tool.run(args ?? {}, ctx);
  } catch (err) {
    console.warn(`[ai/tool] ${name} failed:`, err.message);
    return { error: `เรียก ${name} ไม่สำเร็จ: ${err.message}` };
  }
}
