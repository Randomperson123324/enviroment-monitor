/**
 * The system prompt for the browser engine: a snapshot of the app's data,
 * assembled on the server and handed to the model in one piece.
 *
 * Why this and not tools — a 1.7B–4B model quantised to 4 bits cannot be relied
 * on to call functions and read their results back. Given tools it will
 * hallucinate a call, or answer as though it had made one. So the pattern flips
 * for this engine only: the server runs the same tool handlers (lib/ai/tools.js)
 * and pastes their output in. Server providers keep the tool loop.
 *
 * ── The context budget ───────────────────────────────────────────────────────
 * These models carry a 4096-token window, shared between prompt and answer. At
 * roughly three characters per token that leaves a few thousand characters for
 * everything here — so each section is a summary, not a dump, and the whole
 * thing is capped at the end. Overrunning the window does not error: the model
 * silently loses the beginning of its instructions.
 */
import config from '@/config';
import { MSG } from '@/config/messages.th';
import { runTool } from '@/lib/ai/tools';

/** Chars, not tokens — a deliberate over-estimate of what safely fits. */
const PROMPT_CHAR_CAP = 6000;

/** `title: {json}`, or a plain admission that this part could not be read. */
function section(title, data) {
  if (data == null || data.error || data.available === false) {
    const why = data?.reason ?? data?.error ?? '';
    return `${title}: (ไม่มีข้อมูล${why ? ` — ${why}` : ''})`;
  }
  return `${title}:\n${JSON.stringify(data)}`;
}

/**
 * Build the prompt. `provider` is passed through to `runTool`, so the focus
 * section is subject to exactly the same gate as every other caller — see
 * config.ai.focusProviders.
 */
export async function buildBrowserPrompt({ deviceId, lang = 'th', provider = 'browser' }) {
  const ctx = { provider, deviceId, lang };
  const call = (name, args) => runTool(name, args, ctx).catch((err) => ({ error: err.message }));

  const [latest, trend, health, focus, water] = await Promise.all([
    call('get_sensor_latest', {}),
    call('get_sensor_history', { hours: config.ai.summary.envHours }),
    call('get_health_risks', {}),
    call('get_focus_activity', { rows: config.ai.browser.focusRows }),
    call('get_government_water', {}),
  ]);

  // Counts only for the government feed: the full station list is by far the
  // largest thing available here and would crowd out the room's own numbers.
  const waterBrief =
    water?.error || water?.available === false
      ? water
      : {
          rain_24h_top: (water.rainfall_top ?? []).slice(0, 3),
          river_overflow_stations: water.river?.overflow_stations ?? null,
          reservoirs_over_capacity: water.reservoirs?.over_capacity ?? null,
          warnings: (water.water_warnings ?? []).length,
        };

  const parts = [
    MSG.browser.role,
    // Pinned to Bangkok rather than the server's clock: on a hosted deployment
    // that clock is UTC, and a model told the wrong hour will reason from it.
    `เวลาปัจจุบัน: ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`,
    '',
    MSG.browser.dataHeader,
    '',
    section('ค่าเซ็นเซอร์ล่าสุด', latest),
    section(`แนวโน้ม ${config.ai.summary.envHours} ชม. (ต่ำสุด/สูงสุด/เฉลี่ย)`, trend),
    section('ความเสี่ยงสุขภาพที่ประเมินจากสภาพห้อง', health),
    section('การจดจ่อจากกล้อง (ประมวลผลในเครื่อง)', focus),
    section('สถานการณ์น้ำ/ฝนจากหน่วยงานรัฐ (ย่อ)', waterBrief),
    '',
    MSG.browser.rules,
  ];

  const prompt = parts.join('\n');
  return prompt.length > PROMPT_CHAR_CAP ? `${prompt.slice(0, PROMPT_CHAR_CAP)}\n…(ตัดข้อมูลส่วนท้ายออกเพราะยาวเกิน)` : prompt;
}
