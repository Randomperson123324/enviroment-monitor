'use client';

import { useMemo, useState } from 'react';
import { Eye, BookOpen, X, TriangleAlert, VideoOff } from 'lucide-react';
import { Line } from 'react-chartjs-2';
import '@/components/charts/setup';
import useFocus, { movementCount } from '@/hooks/useFocus';
import SectionHeader from '@/components/SectionHeader';
import {
  CHART_COLORS,
  CLIENT_FALLBACK,
  FOCUS_THRESHOLD_INPUT,
  ID_SERIES_PALETTE,
  withAlpha,
} from '@/config/client';
import { tooltipOptions } from '@/lib/chart-utils';
import { useLang } from '@/hooks/useLang';

// [glossary key shown literally, i18n key for its description]
const GLOSSARY = [
  ['person', 'focus.gPerson'],
  ['name', 'focus.gName'],
  ['movement', 'focus.gMovement'],
  ['direction', 'focus.gDirection'],
  ['posture', 'focus.gPosture'],
  ['emotion', 'focus.gEmotion'],
  ['face_count', 'focus.gFaceCount'],
  ['created_at', 'focus.gCreatedAt'],
];

// Values pi-vision writes (body.py / emotion.py) → the i18n key that names them.
const POSTURE_KEYS = {
  standing: 'focus.poseStanding',
  sitting: 'focus.poseSitting',
  lying: 'focus.poseLying',
};
const EMOTION_KEYS = {
  happy: 'focus.emoHappy',
  sad: 'focus.emoSad',
  surprised: 'focus.emoSurprised',
  angry: 'focus.emoAngry',
  neutral: 'focus.emoNeutral',
};

/**
 * Translate a value the Pi wrote, falling back to the raw string.
 * A label added on the Pi but not here should read as itself — translate() returns
 * the key name for anything it does not know, which would surface as "focus.emoX".
 */
const vocab = (map, value, t) => (value ? (map[value] ? t(map[value]) : value) : null);

// [direction field in the data, i18n key for its label]
const DIRECTIONS = [
  ['Left', 'focus.dirLeft'],
  ['Right', 'focus.dirRight'],
  ['Up', 'focus.dirUp'],
  ['Down', 'focus.dirDown'],
];

// จำนวน ID สูงสุดที่ให้สีต่างกันในกราฟ — เกินนี้ยุบเป็น "+N อื่น ๆ" (ห้าม cycle สี)
const MAX_ID_SERIES = ID_SERIES_PALETTE.dark.length;

const hhmm = (ts) =>
  new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });

/** Recognised name when the Pi matched a gallery photo, the track number otherwise. */
const personLabel = (s) => s.name ?? `#${s.person}`;

/**
 * Merge one tallied field across buckets into a share-of-time breakdown.
 * Returns `[{ label, count, pct }]`, commonest first, with `total` rows behind it.
 */
function mixOf(buckets, field) {
  const totals = new Map();
  for (const b of buckets) {
    for (const [label, n] of b[field]) totals.set(label, (totals.get(label) ?? 0) + n);
  }
  const total = [...totals.values()].reduce((a, n) => a + n, 0);
  const parts = [...totals.entries()]
    .map(([label, count]) => ({ label, count, pct: total ? (count / total) * 100 : 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { total, parts };
}

/**
 * The name each track number settled on — `Map(track -> name | undefined)`.
 *
 * Decided per track across every row it ever wrote, because pi-vision guesses the
 * closest gallery face by default (FACES_GUESS) and a track can carry a stray name
 * for a window or two before settling. Taking the majority means one bad window
 * cannot rename a person; a real correction still wins within a minute, since the
 * Pi writes a row every 15s. Ties fall to the newer name.
 */
function resolveTrackNames(chrono) {
  const votes = new Map(); // track -> Map(name -> rows that said so)
  for (const r of chrono) {
    if (!r.name || r.person == null) continue;
    const track = String(r.person);
    if (!votes.has(track)) votes.set(track, new Map());
    const tally = votes.get(track);
    tally.set(r.name, (tally.get(r.name) ?? 0) + 1);
  }

  const winners = new Map();
  for (const [track, tally] of votes) {
    let best = null;
    let bestCount = -1;
    // chrono order means later names are seen later, so `>` leaves ties on the newer.
    for (const [name, count] of tally) {
      if (count >= bestCount) [best, bestCount] = [name, count];
    }
    winners.set(track, best);
  }
  return winners;
}

/**
 * Group rows into per-person time buckets so each person becomes its own line.
 *
 * Keyed on the **recognised name** where there is one, not the track number. In the
 * activity mode the user runs, pi-vision sets `reid=False` on purpose: identity comes
 * from the faces/ folder alone, so someone who leaves the frame and returns is issued
 * a brand-new number while their name comes back from the photo match. Keying on the
 * number would draw one person as three unrelated lines (Pun #1, Pun #2, Pun #4).
 * Tracks the Pi never named still key on their number — there is nothing else to use.
 *
 * Slots are assigned by ascending first-seen track number, so a newly-arrived person
 * appends without repainting the others — colour follows the entity, never position.
 */
function buildPersonSeries(rows, bucketMs, maxBars) {
  const byPerson = new Map(); // identity -> Map(ts -> bucket)
  const trackIds = new Map(); // identity -> Set(track numbers folded into it)
  const tsSet = new Set();

  // Oldest first, so every "last write wins" field below (direction, posture) really
  // does end up holding the newest value. The rows arrive newest-first.
  const chrono = [...rows].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const trackNames = resolveTrackNames(chrono);

  for (const r of chrono) {
    const t = Date.parse(r.created_at);
    if (!Number.isFinite(t)) continue;
    const ts = Math.floor(t / bucketMs) * bucketMs;
    const track = r.person == null ? '—' : String(r.person);
    // Resolved per track, not per row: a track's first rows are nameless while the
    // face signature settles, and keying those on the number would split the very
    // person this grouping exists to keep whole.
    const name = trackNames.get(track) ?? null;
    const person = name ?? track;
    if (!trackIds.has(person)) trackIds.set(person, new Set());
    trackIds.get(person).add(track);
    tsSet.add(ts);
    if (!byPerson.has(person)) byPerson.set(person, new Map());
    const slotMap = byPerson.get(person);
    if (!slotMap.has(ts)) {
      slotMap.set(ts, {
        ts,
        movement: 0,
        face_count: 0,
        count: 0,
        direction: null,
        name: null,
        posture: null,
        postureSure: true,
        emotion: null,
        // Tallied per bucket rather than per person so the overview covers exactly
        // the window the chart draws — buckets outside it are dropped below, and
        // counts kept alongside the person would keep counting rows already scrolled
        // off the left edge.
        postures: new Map(),
        emotions: new Map(),
        unsurePostures: 0,
      });
    }
    const b = slotMap.get(ts);
    b.movement += movementCount(r.movement);
    b.face_count = Math.max(b.face_count, r.face_count ?? 0);
    b.count++;
    if (r.direction) b.direction = r.direction;
    if (name) b.name = name;
    if (r.emotion) {
      b.emotion = r.emotion;
      b.emotions.set(r.emotion, (b.emotions.get(r.emotion) ?? 0) + 1);
    }
    if (r.posture) {
      b.posture = r.posture;
      // The Pi answers with a posture even when a desk hides the legs, and says so
      // in this column. Treat a missing flag as unsure rather than as measured —
      // rows written before the column existed have no evidence behind them.
      b.postureSure = r.posture_confident === true;
      b.postures.set(r.posture, (b.postures.get(r.posture) ?? 0) + 1);
      if (!b.postureSure) b.unsurePostures++;
    }
  }

  let labels = [...tsSet].sort((a, b) => a - b);
  if (labels.length > maxBars) labels = labels.slice(-maxBars);
  const inWindow = new Set(labels);

  // Track numbers climb over time, so a person's lowest one stands in for "when we
  // first saw them" — ordering by it keeps existing lines on their colour when a new
  // person shows up, which ordering by name would not (a new "Ann" would sort first
  // and repaint everyone after her).
  const firstSeen = (person) =>
    Math.min(...[...(trackIds.get(person) ?? [])].map((id) => Number(id) || Infinity));

  const persons = [...byPerson.keys()]
    .map((p) => {
      const pts = [...byPerson.get(p).values()].filter((b) => inWindow.has(b.ts));
      return { person: p, pts };
    })
    .filter((s) => s.pts.length > 0)
    .sort((a, b) => {
      const fa = firstSeen(a.person);
      const fb = firstSeen(b.person);
      if (fa !== fb) return fa - fb;
      return String(a.person).localeCompare(String(b.person));
    });

  const overflow = Math.max(0, persons.length - MAX_ID_SERIES);

  const series = persons.slice(0, MAX_ID_SERIES).map(({ person, pts }, slot) => {
    const byTs = new Map(pts.map((b) => [b.ts, b]));
    const points = labels.map((ts) => byTs.get(ts) ?? null);
    const values = points.map((p) => (p ? p.movement : null));
    const total = pts.reduce((a, p) => a + p.movement, 0);
    const max = pts.reduce((a, p) => Math.max(a, p.movement), 0);
    const last = pts[pts.length - 1] ?? null;
    const name = pts.reduce((found, p) => p.name ?? found, null);
    // Every track number folded into this person, oldest first. Worth surfacing: it
    // is what the Pi's own console and HUD print, so it is the only way to tie a line
    // on this chart back to a line in the terminal.
    const ids = [...(trackIds.get(person) ?? [])].sort((a, b) => Number(a) - Number(b));
    // Posture and emotion are states, not identity: the newest reading wins, and the
    // bucket that carried it also carries whether it was measured or inferred.
    const posed = pts.reduce((found, p) => (p.posture ? p : found), null);
    return {
      person,
      name,
      ids,
      posture: posed?.posture ?? null,
      postureSure: posed?.postureSure ?? true,
      emotion: pts.reduce((found, p) => p.emotion ?? found, null),
      // How the whole window broke down, not just where it ended — one glance at
      // "sat 80% of the time" says more about a session than the final reading does.
      postureMix: mixOf(pts, 'postures'),
      emotionMix: mixOf(pts, 'emotions'),
      unsurePostures: pts.reduce((a, p) => a + p.unsurePostures, 0),
      slot,
      points,
      values,
      total,
      max,
      avg: pts.length ? total / pts.length : 0,
      buckets: pts.length,
      latest: last?.movement ?? null,
      latestDirection: last?.direction ?? null,
      latestFace: last?.face_count ?? null,
    };
  });

  return { labels, series, overflow };
}

function FocusIdChart({ labels, series, palette, colors, threshold, selected, onSelect, t }) {
  const data = useMemo(() => {
    const dimmed = selected != null;
    const lines = series.map((s) => {
      const hue = palette[s.slot] ?? colors.tick;
      const active = !dimmed || s.person === selected;
      return {
        _person: s.person,
        label: personLabel(s),
        data: s.values,
        borderColor: active ? hue : withAlpha(hue, 0.22),
        backgroundColor: withAlpha(hue, 0.1),
        borderWidth: s.person === selected ? 3 : dimmed ? 1.25 : 2,
        pointRadius: s.person === selected ? 3 : 2,
        pointHoverRadius: 6,
        pointBackgroundColor: active ? hue : withAlpha(hue, 0.22),
        pointBorderWidth: 0,
        tension: 0.32,
        spanGaps: true,
        order: s.person === selected ? 0 : 1,
      };
    });
    // เส้นเกณฑ์แจ้งเตือน (คงที่) — เป็น dataset ท้ายสุด ไม่นับใน onClick/legend
    lines.push({
      _threshold: true,
      label: 'threshold',
      data: labels.map(() => threshold),
      borderColor: withAlpha(colors.focusOver, 0.7),
      borderWidth: 1.25,
      borderDash: [6, 6],
      pointRadius: 0,
      pointHoverRadius: 0,
      fill: false,
      order: 5,
    });
    return { labels: labels.map(hhmm), datasets: lines };
  }, [labels, series, palette, colors, threshold, selected]);

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      onHover: (e, els) => {
        if (e?.native?.target) e.native.target.style.cursor = els.length ? 'pointer' : 'default';
      },
      onClick: (_e, els) => {
        const hit = els.find((el) => series[el.datasetIndex]);
        if (hit) {
          const s = series[hit.datasetIndex];
          onSelect(s.person === selected ? null : s.person);
        }
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: colors.tick, maxTicksLimit: 10, maxRotation: 35, minRotation: 20 },
        },
        y: {
          min: 0,
          suggestedMax: Math.max(threshold * 1.5, ...series.flatMap((s) => s.values.map((v) => v ?? 0)), 10),
          grid: { color: colors.grid },
          border: { display: false },
          ticks: { color: colors.tick },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipOptions(colors, labels),
          filter: (item) => !item.dataset._threshold,
          callbacks: {
            title: (items) => `🕐 ${items[0]?.label ?? ''}`,
            label: (ctx) => {
              const s = series[ctx.datasetIndex];
              if (!s) return null;
              const b = s.points[ctx.dataIndex];
              const lines = [
                `${personLabel(s)} · ${t('focus.tipMove', { y: ctx.parsed.y })}${ctx.parsed.y > threshold ? ' ⚠' : ''}`,
              ];
              if (b?.direction) {
                const d = b.direction;
                lines.push(
                  `   ${t('focus.tipDir', { l: d.Left ?? 0, r: d.Right ?? 0, u: d.Up ?? 0, d: d.Down ?? 0 })}`
                );
              }
              const pose = vocab(POSTURE_KEYS, b?.posture, t);
              const mood = vocab(EMOTION_KEYS, b?.emotion, t);
              const state = [pose && `${pose}${b.postureSure ? '' : '?'}`, mood].filter(Boolean);
              if (state.length) lines.push(`   ${state.join(' · ')}`);
              return lines;
            },
          },
        },
      },
    }),
    [series, colors, threshold, labels, selected, onSelect, t]
  );

  return <Line data={data} options={options} />;
}

function IdDetail({ series, palette, colors, threshold, onClose, t }) {
  const hue = palette[series.slot] ?? colors.tick;
  const over = series.latest != null && series.latest > threshold;
  const dir = series.latestDirection;
  const dirTotal = dir ? DIRECTIONS.reduce((a, [k]) => a + (Number(dir[k]) || 0), 0) || 1 : 1;

  return (
    <div className="panel id-detail" style={{ borderTopColor: hue }}>
      <div className="fcard-label">
        <span className="id-legend-item">
          <span className="id-swatch" style={{ background: hue }} />
          {series.name
            ? t('focus.detailTitleNamed', { name: series.name })
            : t('focus.detailTitle', { id: series.person })}
        </span>
        <button className="id-detail-close" onClick={onClose} aria-label={t('focus.closeDetail')}>
          <X size={15} strokeWidth={2.4} aria-hidden />
        </button>
      </div>
      <div className="fcard-val" style={{ color: over ? 'var(--lv-danger)' : hue }}>
        {series.latest ?? '--'}
        <span className={`badge ${over ? 'danger' : ''}`} style={{ marginLeft: 10, verticalAlign: 'middle' }}>
          {series.latest == null ? '—' : over ? t('focus.high') : t('focus.normal')}
        </span>
      </div>
      <div className="fcard-sub">{t('focus.latestMove', { th: threshold })}</div>

      <div className="id-stat-grid">
        <div>
          <div className="dir-label">{t('focus.avg')}</div>
          <div className="dir-val">{series.avg.toFixed(1)}</div>
        </div>
        <div>
          <div className="dir-label">{t('focus.max')}</div>
          <div className="dir-val">{series.max}</div>
        </div>
        <div>
          <div className="dir-label">{t('focus.seen')}</div>
          <div className="dir-val">{t('focus.mins', { n: series.buckets })}</div>
        </div>
        <div>
          <div className="dir-label">{t('focus.faces')}</div>
          <div className="dir-val">{series.latestFace ?? '--'}</div>
        </div>
        <div>
          <div className="dir-label">{t('focus.posture')}</div>
          <div className="dir-val">
            {vocab(POSTURE_KEYS, series.posture, t) ?? '--'}
            {/* Inferred, not measured — the same "?" the Pi's own HUD uses. Dropping
                it would let a guess made behind a desk read as a reading. */}
            {series.posture && !series.postureSure && (
              <span className="pose-unsure" title={t('focus.postureUnsure')}>
                ?
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="dir-label">{t('focus.emotion')}</div>
          <div className="dir-val">{vocab(EMOTION_KEYS, series.emotion, t) ?? '--'}</div>
        </div>
        {/* Only worth the space once a person has been issued more than one number —
            for a single track it just repeats the title. */}
        {series.name && series.ids.length > 1 && (
          <div className="id-track-list">
            <div className="dir-label">{t('focus.trackIds', { n: series.ids.length })}</div>
            <div className="dir-val">{series.ids.map((id) => `#${id}`).join(' · ')}</div>
          </div>
        )}
      </div>

      {dir && (
        <div className="dir-grid" style={{ marginTop: 12 }}>
          {DIRECTIONS.map(([key, labelKey]) => {
            const v = Number(dir[key]) || 0;
            return (
              <div key={key}>
                <div className="dir-label">{t(labelKey)}</div>
                <div className="dir-val">{v}</div>
                <div className="dir-bar">
                  <div
                    className="dir-fill"
                    style={{ width: `${Math.round((v / dirTotal) * 100)}%`, background: hue }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** One "70% นั่ง" row with its bar. */
function MixRow({ label, count, pct, hue }) {
  return (
    <div className="mix-row">
      <div className="mix-head">
        <span className="mix-label">{label}</span>
        <span className="mix-pct">{Math.round(pct)}%</span>
      </div>
      <div className="dir-bar">
        <div className="dir-fill" style={{ width: `${pct}%`, background: hue }} />
      </div>
      <div className="mix-count">{count}</div>
    </div>
  );
}

/**
 * How the selected person's window broke down, under the detail card.
 *
 * Shares of time, not the latest reading — the card above already answers "right
 * now". A session is better described by "sat for most of it, stood twice" than by
 * whichever value happened to land in the final 15-second window.
 */
function PersonOverview({ series, hue, keys, titleKey, t }) {
  const { total, parts } = series[keys.mix];
  return (
    <div className="overview-block">
      <div className="dir-label">{t(titleKey)}</div>
      {total === 0 ? (
        <div className="overview-empty">{t('focus.noData')}</div>
      ) : (
        parts.map((p) => (
          <MixRow
            key={p.label}
            label={vocab(keys.vocab, p.label, t)}
            count={p.count}
            pct={p.pct}
            hue={hue}
          />
        ))
      )}
    </div>
  );
}

export default function FocusSection({ focusCfg, addLog, theme }) {
  const { t } = useLang();
  const colors = CHART_COLORS[theme] ?? CHART_COLORS.dark;
  const palette = ID_SERIES_PALETTE[theme] ?? ID_SERIES_PALETTE.dark;
  const { rows, buckets, latest, threshold, setThreshold, connected } = useFocus({ focusCfg, addLog });
  const [selected, setSelected] = useState(null);

  const maxBars = focusCfg?.chartBuckets ?? CLIENT_FALLBACK.focus.chartBuckets;
  const bucketMs = focusCfg?.bucketMs ?? CLIENT_FALLBACK.focus.bucketMs;

  const { labels, series, overflow } = useMemo(
    () => buildPersonSeries(rows, bucketMs, maxBars),
    [rows, bucketMs, maxBars]
  );

  // ID ที่เลือกอาจหลุดออกนอกหน้าต่างเวลาไปแล้ว — อ้างจาก series ปัจจุบันเสมอ
  const selectedSeries = selected != null ? series.find((s) => s.person === selected) ?? null : null;
  // ถ้า ID ที่เลือกไม่อยู่ในกราฟแล้ว อย่าหรี่เส้นอื่นทิ้งโดยไม่มีตัวไฮไลต์
  const activeSel = selectedSeries ? selected : null;

  const lastBucket = buckets[buckets.length - 1] ?? null;
  const mvPerMin = lastBucket?.movement ?? null;
  const overThreshold = mvPerMin != null && mvPerMin > threshold;
  const faceCount = latest?.face_count ?? null;

  return (
    <section className="section-gap">
      <SectionHeader Icon={Eye} title={t('focus.title')} live={connected}>
        <div className="focus-controls">
          <label>
            {t('focus.thresholdPre')}{' '}
            <input
              type="number"
              className="threshold-input"
              aria-label={`${t('focus.thresholdPre')} (${t('focus.thresholdPost')})`}
              min={FOCUS_THRESHOLD_INPUT.min}
              max={FOCUS_THRESHOLD_INPUT.max}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />{' '}
            {t('focus.thresholdPost')}
          </label>
        </div>
      </SectionHeader>

      {overThreshold && (
        <div className="alert-bar" style={{ marginBottom: 10 }} role="alert">
          <TriangleAlert size={16} strokeWidth={2.4} aria-hidden />
          <span>{t('focus.over', { mv: mvPerMin, th: threshold })}</span>
        </div>
      )}

      <div className="focus-grid">
        <div className="focus-main">
          <div className="panel">
            <div className="panel-title">{t('focus.chartTitle')}</div>
            <div className="panel-meta" style={{ margin: '4px 0 8px' }}>
              {series.length
                ? t('focus.chartMeta', { people: series.length, mins: Math.min(labels.length, maxBars) })
                : t('focus.waiting')}
            </div>
            <div className="focus-chart-stage">
              {series.length ? (
                <FocusIdChart
                  key={theme}
                  labels={labels}
                  series={series}
                  palette={palette}
                  colors={colors}
                  threshold={threshold}
                  selected={activeSel}
                  onSelect={setSelected}
                  t={t}
                />
              ) : (
                <div className="focus-empty">
                  <VideoOff size={22} strokeWidth={1.8} aria-hidden />
                  <p className="focus-empty-title">{t('focus.empty')}</p>
                  <p className="focus-empty-hint">{t('focus.emptyHint')}</p>
                </div>
              )}
            </div>

            {series.length > 0 && (
              <div className="id-legend">
                {series.map((s) => {
                  const hue = palette[s.slot] ?? colors.tick;
                  const active = activeSel == null || activeSel === s.person;
                  return (
                    <button
                      key={s.person}
                      type="button"
                      className={`id-legend-item ${selected === s.person ? 'selected' : ''} ${active ? '' : 'dim'}`}
                      onClick={() => setSelected(selected === s.person ? null : s.person)}
                      aria-pressed={selected === s.person}
                    >
                      <span className="id-swatch" style={{ background: hue }} />
                      {/* A named line can span several track numbers, so no single
                          number belongs on the chip. The detail card lists them. */}
                      <span className={s.name ? 'id-person-name' : ''}>{personLabel(s)}</span>
                    </button>
                  );
                })}
                {overflow > 0 && <span className="id-legend-more">{t('focus.more', { n: overflow })}</span>}
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-title gov-card-title">
              <BookOpen size={15} strokeWidth={2.2} aria-hidden /> {t('focus.glossaryTitle')}
            </div>
            <div className="glossary">
              {GLOSSARY.map(([key, descKey]) => (
                <div key={key} className="glossary-row">
                  <span className="glossary-key">{key}</span>
                  <span className="glossary-desc">{t(descKey)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="focus-cards">
          {selectedSeries ? (
            <>
              <IdDetail
                series={selectedSeries}
                palette={palette}
                colors={colors}
                threshold={threshold}
                onClose={() => setSelected(null)}
                t={t}
              />
              <div className="panel person-overview">
                <div className="fcard-label">
                  <span>{t('focus.overviewTitle', { who: personLabel(selectedSeries) })}</span>
                </div>
                <div className="fcard-sub">
                  {t('focus.overviewSub', { mins: selectedSeries.buckets })}
                </div>
                <PersonOverview
                  series={selectedSeries}
                  hue={palette[selectedSeries.slot] ?? colors.tick}
                  keys={{ mix: 'postureMix', vocab: POSTURE_KEYS }}
                  titleKey="focus.posture"
                  t={t}
                />
                {/* Counted, not just flagged: "3 of 12 were guesses" is a different
                    fact from "the latest one was", and only the count tells you how
                    much of the breakdown above rests on the legs being visible. */}
                {selectedSeries.unsurePostures > 0 && (
                  <div className="overview-note">
                    {t('focus.unsureCount', { n: selectedSeries.unsurePostures })}
                  </div>
                )}
                <PersonOverview
                  series={selectedSeries}
                  hue={palette[selectedSeries.slot] ?? colors.tick}
                  keys={{ mix: 'emotionMix', vocab: EMOTION_KEYS }}
                  titleKey="focus.emotion"
                  t={t}
                />
              </div>
            </>
          ) : (
            <div className="panel id-detail-hint">
              <div className="fcard-label">
                <span>{t('focus.detailHintTitle')}</span>
              </div>
              <div className="fcard-sub">{t('focus.detailHint')}</div>
            </div>
          )}

          <div className="panel">
            <div className="fcard-label">
              <span>{t('focus.totalMove')}</span>
              <span className={`badge ${overThreshold ? 'danger' : mvPerMin != null ? '' : 'nodata'}`}>
                {mvPerMin == null ? '—' : overThreshold ? t('focus.high') : t('focus.normal')}
              </span>
            </div>
            <div className="fcard-val">{mvPerMin ?? '--'}</div>
            <div className="fcard-sub">
              {t('focus.totalSub')}
              <br />
              {t('focus.thresholdInfo', { th: threshold })}
            </div>
          </div>

          <div className="panel">
            <div className="fcard-label">
              <span>{t('focus.faceCount')}</span>
            </div>
            {/*
              Status colours only, and only where they mean something:
                no data → muted        nobody in frame → muted (they stepped away,
                one person → ok         nothing is broken)
                more than one → warning (someone else is in the room)
              It used to paint "one person" in the humidity series colour and
              "nobody" in danger red, which read as an alarm over normal events.
            */}
            <div
              className="fcard-val"
              style={{
                color:
                  faceCount == null || faceCount === 0
                    ? 'var(--muted)'
                    : faceCount > 1
                      ? 'var(--lv-warning)'
                      : 'var(--lv-ok)',
              }}
            >
              {faceCount ?? '--'}
            </div>
            <div className="fcard-sub">
              {faceCount == null
                ? t('focus.faceWaiting')
                : faceCount === 0
                  ? t('focus.faceNone')
                  : faceCount === 1
                    ? t('focus.faceOne')
                    : t('focus.faceMany', { n: faceCount })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
