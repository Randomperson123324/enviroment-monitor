/**
 * Do two things measured in this room move together?
 *
 * The assistant could already read the air and the camera, but only one at a
 * time. Asked "ช่วงที่ CO₂ สูงขึ้น การมีส่วนร่วมของห้องลดลงหรือไม่" it held two
 * unrelated summaries and no way to line them up — the tables are written by
 * different devices at different rates — so it would answer from the shape of
 * the question rather than from the data. A model that cannot join two series
 * does not say "I cannot"; it asserts. This module does the join in code so the
 * answer carries a number and a sample size.
 *
 * Pure functions: no I/O, no config import, no `@/` alias. Every tunable arrives
 * as an argument (see config.ai.correlate) and the rows arrive from the caller,
 * which is what makes the arithmetic runnable — and therefore checkable — on its
 * own.
 *
 * ── What "engagement" can honestly mean here ─────────────────────────────────
 * The focus table stores, per person per pi-vision window: how many times that
 * person turned their head away from their own neutral pose (`movement`), how
 * many faces were in frame (`face_count`), plus name/emotion/posture. There is
 * no engagement column, and none of these is one.
 *
 * The closest honest proxy is the head-turn rate — the very number the dashboard
 * already flags against FOCUS_THRESHOLD_DEFAULT — where **higher means less
 * settled**. So "CO₂ up, engagement down" appears here as a *positive* r between
 * co2 and turns_per_person_per_min, and reading the sign backwards inverts the
 * conclusion. Every field that leaves this module is named for what it measures
 * (`turns_…`), never for what someone hopes it stands for, so the model has to
 * describe the direction rather than assume it.
 */

/** Movement is stored either as a count or as an object of per-direction counts. */
export function movementCount(m) {
  if (typeof m === 'number') return m;
  if (m && typeof m === 'object') return Object.values(m).reduce((a, v) => a + (Number(v) || 0), 0);
  return Number(m) || 0;
}

/** Reject null/'' before Number(): `Number(null)` is 0, which reads as a real measurement. */
const has = (v) => v != null && v !== '';

const round = (n, d = 2) => (Number.isFinite(n) ? Number(n.toFixed(d)) : null);

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Bucket width for a window, in ms.
 *
 * Buckets are the unit of the whole analysis, so the width decides what the
 * correlation is even about: too narrow and each bucket holds one env reading
 * against one camera window, which correlates sampling noise; too wide and the
 * day flattens into three points that no coefficient can speak for. Aiming at a
 * fixed *number* of buckets keeps the resolution comparable whether the question
 * covers three hours or three days.
 */
export function bucketMsFor(hours, { targetBuckets, minMinutes, maxMinutes }) {
  const wanted = (hours * 60) / Math.max(targetBuckets, 1);
  const minutes = Math.min(maxMinutes, Math.max(minMinutes, Math.round(wanted)));
  return minutes * 60000;
}

const bucketKey = (iso, bucketMs) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor(t / bucketMs) * bucketMs : null;
};

/**
 * Line the two tables up on a shared clock.
 *
 * Keeps only buckets that have **both** kinds of row. A stretch with air
 * readings but no camera (the Pi was off) says nothing about how the two relate,
 * and letting it through as a zero would invent exactly the quiet-room-with-bad-
 * air evidence the question is asking about.
 */
export function alignBuckets({ envRows, focusRows, fields, bucketMs, windowSeconds }) {
  const env = new Map();
  for (const r of envRows ?? []) {
    const key = bucketKey(r.created_at, bucketMs);
    if (key == null) continue;
    if (!env.has(key)) env.set(key, new Map());
    const slot = env.get(key);
    for (const f of fields) {
      if (!has(r[f])) continue;
      const v = Number(r[f]);
      if (!Number.isFinite(v)) continue;
      if (!slot.has(f)) slot.set(f, []);
      slot.get(f).push(v);
    }
  }

  const focus = new Map();
  for (const r of focusRows ?? []) {
    const key = bucketKey(r.created_at, bucketMs);
    if (key == null) continue;
    if (!focus.has(key)) {
      focus.set(key, { turns: 0, windows: 0, people: new Set(), peakFaces: 0 });
    }
    const slot = focus.get(key);
    slot.turns += movementCount(r.movement);
    slot.windows += 1;
    // Named people and bare track numbers are both identities; an unnamed row
    // still represents a body in the room and must count toward attendance.
    slot.people.add(r.name ?? (r.person != null ? `#${r.person}` : 'unknown'));
    slot.peakFaces = Math.max(slot.peakFaces, Number(r.face_count) || 0);
  }

  const out = [];
  for (const [ts, slot] of focus) {
    const envSlot = env.get(ts);
    if (!envSlot) continue;
    // Each focus row covers one pi-vision window of one person, so the observed
    // time is windows × window length — not the bucket length. That distinction
    // is what keeps a bucket where someone was present for 20 seconds from
    // reading as a calm hour.
    const personMinutes = (slot.windows * windowSeconds) / 60;
    out.push({
      ts,
      env: Object.fromEntries([...envSlot].map(([f, vals]) => [f, mean(vals)])),
      turns_per_person_per_min: personMinutes > 0 ? slot.turns / personMinutes : null,
      people: slot.people.size,
      peak_faces: slot.peakFaces,
      env_samples: [...envSlot.values()].reduce((a, v) => Math.max(a, v.length), 0),
      focus_windows: slot.windows,
    });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/**
 * Pearson r over paired values.
 *
 * A flat series returns `r: null` with a reason rather than 0. The two are
 * opposite claims — "they do not move together" versus "one of them never moved,
 * so nothing can be said" — and a sensor pinned at its floor overnight is the
 * common way to produce the second while looking like the first.
 */
export function pearson(pairs) {
  const clean = (pairs ?? []).filter(
    ([x, y]) => Number.isFinite(x) && Number.isFinite(y)
  );
  const n = clean.length;
  if (n < 2) return { r: null, n, reason: 'จุดข้อมูลไม่พอ' };

  const xs = clean.map(([x]) => x);
  const ys = clean.map(([, y]) => y);
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) {
    return { r: null, n, reason: 'ค่าหนึ่งไม่เปลี่ยนเลยในช่วงนี้ จึงหาความสัมพันธ์ไม่ได้' };
  }
  return { r: sxy / Math.sqrt(sxx * syy), n };
}

/** Plain-language strength, so the model does not have to invent a scale for r. */
export function strengthOf(r, { strong, moderate, weak }) {
  if (r == null) return null;
  const a = Math.abs(r);
  if (a >= strong) return 'ชัดเจน';
  if (a >= moderate) return 'ปานกลาง';
  if (a >= weak) return 'อ่อน';
  return 'แทบไม่มีความสัมพันธ์';
}

/**
 * Split the window at the sensor's own median and compare the two halves.
 *
 * This is the part that answers the question as it is actually asked — "ช่วงที่
 * CO₂ สูงขึ้น … ลดลงหรือไม่" wants two averages to hold side by side, not a
 * coefficient. Splitting at the median rather than at a guideline (1000 ppm,
 * say) guarantees both halves exist: a room that never crosses the guideline
 * would otherwise return an empty group and no answer at all, when it still has
 * a perfectly good high-half and low-half of its own range.
 */
export function contrastAtMedian(buckets, field, metric) {
  const usable = buckets.filter(
    (b) => Number.isFinite(b.env?.[field]) && Number.isFinite(b[metric])
  );
  if (usable.length < 2) return null;
  const cut = median(usable.map((b) => b.env[field]));
  const high = usable.filter((b) => b.env[field] > cut);
  const low = usable.filter((b) => b.env[field] <= cut);
  if (!high.length || !low.length) return null;

  const hi = mean(high.map((b) => b[metric]));
  const lo = mean(low.map((b) => b[metric]));
  return {
    split_at: round(cut, 1),
    high: { buckets: high.length, [metric]: round(hi), avg_sensor: round(mean(high.map((b) => b.env[field])), 1) },
    low: { buckets: low.length, [metric]: round(lo), avg_sensor: round(mean(low.map((b) => b.env[field])), 1) },
    change_pct: lo ? round(((hi - lo) / Math.abs(lo)) * 100, 1) : null,
  };
}

/**
 * The whole analysis, ready to hand to a model.
 *
 * `metrics` names the camera-side columns to test; `fields` the sensor columns.
 * Findings come back sorted by |r| so the strongest relationship is the first
 * thing read, and every entry carries its own `n` — a model shown only
 * coefficients will quote the largest one regardless of how few buckets it rests
 * on.
 */
export function analyzeCorrelation({
  envRows,
  focusRows,
  fields,
  metrics,
  hours,
  units = {},
  cfg,
}) {
  const bucketMs = bucketMsFor(hours, cfg);
  const buckets = alignBuckets({
    envRows,
    focusRows,
    fields,
    bucketMs,
    windowSeconds: cfg.windowSeconds,
  });

  const bucketMinutes = bucketMs / 60000;
  if (buckets.length < cfg.minBuckets) {
    return {
      available: false,
      hours,
      bucket_minutes: bucketMinutes,
      overlapping_buckets: buckets.length,
      // Says what to do next, not just that it failed. The usual cause is a
      // camera that ran for one session inside a long window: at 24 buckets per
      // window a 3-day question makes 2-hour buckets, and forty minutes of
      // camera time lands in one of them. Asking for fewer hours narrows the
      // buckets around the stretch that actually has both, which is a fix the
      // model can apply on its own instead of reporting a dead end.
      reason:
        `มีช่วงเวลาที่มีทั้งค่าเซ็นเซอร์และข้อมูลกล้องพร้อมกันแค่ ${buckets.length} ช่วง ` +
        `(ต้องการอย่างน้อย ${cfg.minBuckets}) — ยังสรุปความสัมพันธ์ไม่ได้`,
      suggestion:
        `กล้องอาจเปิดสั้นกว่าช่วงที่ถาม ลองเรียกใหม่ด้วย hours ที่แคบลง ` +
        `(เช่น ${Math.max(1, Math.round(hours / 8))}) เพื่อให้ช่วงเวลาย่อยละเอียดขึ้นตรงที่มีข้อมูลกล้องจริง`,
    };
  }

  const findings = [];
  for (const field of fields) {
    const withValue = buckets.filter((b) => Number.isFinite(b.env?.[field]));
    if (withValue.length < cfg.minBuckets) continue;

    const against = {};
    for (const metric of metrics) {
      const { r, n, reason } = pearson(withValue.map((b) => [b.env[field], b[metric]]));
      against[metric] = {
        r: round(r, 3),
        n,
        strength: strengthOf(r, cfg.strength),
        // Spelled out because a sign is the one part of this a reader can invert
        // without noticing, and the metric names are not self-evidently directional.
        direction: r == null ? null : r > 0 ? 'ไปทางเดียวกัน' : 'ไปทางตรงข้าม',
        ...(reason ? { note: reason } : {}),
      };
    }

    const strongest = Math.max(
      ...metrics.map((m) => Math.abs(against[m].r ?? 0))
    );
    findings.push({
      sensor: field,
      unit: units[field] ?? null,
      buckets: withValue.length,
      sensor_range: {
        min: round(Math.min(...withValue.map((b) => b.env[field])), 1),
        max: round(Math.max(...withValue.map((b) => b.env[field])), 1),
        avg: round(mean(withValue.map((b) => b.env[field])), 1),
      },
      correlation: against,
      when_high_vs_low: Object.fromEntries(
        metrics
          .map((m) => [m, contrastAtMedian(withValue, field, m)])
          .filter(([, v]) => v)
      ),
      _rank: strongest,
    });
  }

  findings.sort((a, b) => b._rank - a._rank);
  for (const f of findings) delete f._rank;

  return {
    hours,
    bucket_minutes: bucketMinutes,
    overlapping_buckets: buckets.length,
    from: new Date(buckets[0].ts).toISOString(),
    to: new Date(buckets[buckets.length - 1].ts + bucketMs).toISOString(),
    metric_meaning: {
      turns_per_person_per_min:
        'จำนวนครั้งที่คนหนึ่งคนหันหน้าออกจากท่านิ่งต่อนาที — **ยิ่งสูงยิ่งมีส่วนร่วมน้อย** ' +
        `(เกณฑ์ที่หน้าเว็บใช้เตือนคือ ${cfg.attentionThreshold} ครั้ง/คน/นาที)`,
      people: 'จำนวนคนที่กล้องแยกได้ในช่วงนั้น — ใช้ดูการเข้าร่วม ไม่ใช่ความตั้งใจ',
    },
    findings,
    caveats: [
      'ความสัมพันธ์ไม่ใช่เหตุผล — ค่าที่ขยับไปด้วยกันอาจมีสาเหตุร่วมกันอย่างอื่น เช่นช่วงเวลาของวันหรือจำนวนคนในห้อง',
      'ตาราง focus ไม่มีคอลัมน์ device_id จึงถือว่ากล้องกับเซ็นเซอร์อยู่ห้องเดียวกัน',
      'ช่วงที่กล้องปิดหรือไม่มีคนถูกตัดทิ้ง ไม่ได้นับเป็นศูนย์',
    ],
  };
}
