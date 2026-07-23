'use client';

import { useMemo } from 'react';
import { Eye, BookOpen } from 'lucide-react';
import { Bar } from 'react-chartjs-2';
import '@/components/charts/setup';
import useFocus, { movementCount } from '@/hooks/useFocus';
import SectionHeader from '@/components/SectionHeader';
import { CHART_COLORS, CLIENT_FALLBACK, FOCUS_THRESHOLD_INPUT, withAlpha } from '@/config/client';
import { tooltipOptions } from '@/lib/chart-utils';

const GLOSSARY = [
  ['person', 'ID หน้าของบุคคลที่ตรวจจับ (Face ID) — ใช้ระบุว่าเป็นคนเดิมหรือไม่'],
  ['movement', 'จำนวนครั้งที่หัวหัน/ขยับภายใน 15 วินาที — ค่าสูง = เสียสมาธิ'],
  ['direction', 'ทิศทางที่หัน: Left / Right / Up / Down — ตัวเลขคือจำนวนครั้งต่อ 15s'],
  ['face_count', 'จำนวนใบหน้าที่ตรวจพบในกล้องขณะนั้น — >1 คน = มีคนอื่นในห้อง'],
  ['created_at', 'เวลาที่บันทึก (ทุก 15 วินาที) — กราฟรวม 4 ช่วง = 1 นาที'],
];

const DIRECTIONS = [
  ['Left', 'ซ้าย ←'],
  ['Right', 'ขวา →'],
  ['Up', 'บน ↑'],
  ['Down', 'ล่าง ↓'],
];

function FocusChart({ buckets, threshold, colors, maxBars }) {
  const view = buckets.slice(-maxBars);

  const data = useMemo(
    () => ({
      labels: view.map((b) =>
        new Date(b.ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false })
      ),
      datasets: [
        {
          label: 'การเคลื่อนไหว / นาที',
          data: view.map((b) => b.movement),
          backgroundColor: view.map((b) =>
            b.movement > threshold ? withAlpha(colors.focusOver, 0.75) : withAlpha(colors.focus, 0.65)
          ),
          borderColor: view.map((b) => (b.movement > threshold ? colors.focusOver : colors.focus)),
          borderWidth: 1.5,
          borderRadius: 6,
          maxBarThickness: 26,
        },
      ],
    }),
    [view, threshold, colors]
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: colors.tick, maxTicksLimit: 10, maxRotation: 35, minRotation: 20 },
        },
        y: {
          min: 0,
          suggestedMax: Math.max(threshold * 1.5, ...view.map((b) => b.movement), 10),
          grid: { color: colors.grid },
          border: { display: false },
          ticks: { color: colors.tick },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipOptions(colors, view.map((b) => b.ts)),
          callbacks: {
            title: (items) => {
              const b = view[items[0]?.dataIndex];
              return `🕐 ${items[0]?.label ?? ''}${b && b.movement > threshold ? ' ⚠ เกิน!' : ''}`;
            },
            label: (ctx) => {
              const b = view[ctx.dataIndex];
              if (!b) return `ขยับ ${ctx.parsed.y} ครั้ง`;
              const lines = [
                `📊 ขยับ ${b.movement} ครั้ง/นาที (เกณฑ์ ${threshold})`,
                `👤 พบใบหน้า ${b.face_count} คน`,
                `🔢 ข้อมูล ${b.count} ช่วง × 15 วินาที`,
              ];
              if (b.direction) {
                const d = b.direction;
                lines.push(
                  `↔ ซ้าย ${d.Left ?? 0}  ขวา ${d.Right ?? 0}  บน ${d.Up ?? 0}  ล่าง ${d.Down ?? 0}`
                );
              }
              if (b.person != null) lines.push(`🪪 บุคคลที่ ${b.person}`);
              return lines;
            },
          },
        },
      },
    }),
    [colors, view, threshold]
  );

  return <Bar data={data} options={options} />;
}

export default function FocusSection({ focusCfg, addLog, theme }) {
  const colors = CHART_COLORS[theme] ?? CHART_COLORS.dark;
  const { rows, buckets, latest, threshold, setThreshold, connected } = useFocus({
    focusCfg,
    addLog,
  });

  const lastBucket = buckets[buckets.length - 1] ?? null;
  const mvPerMin = lastBucket?.movement ?? null;
  const overThreshold = mvPerMin != null && mvPerMin > threshold;

  const faceCount = latest?.face_count ?? null;
  const dir = latest?.direction ?? null;
  const dirTotal = dir
    ? DIRECTIONS.reduce((a, [k]) => a + (Number(dir[k]) || 0), 0) || 1
    : 1;

  const maxBars = focusCfg?.chartBuckets ?? CLIENT_FALLBACK.focus.chartBuckets;

  return (
    <section className="section-gap">
      <SectionHeader Icon={Eye} title="การจดจ่อจากกล้อง" live={connected}>
        <div className="focus-controls">
          <label>
            แจ้งเตือนเมื่อขยับเกิน{' '}
            <input
              type="number"
              className="threshold-input"
              min={FOCUS_THRESHOLD_INPUT.min}
              max={FOCUS_THRESHOLD_INPUT.max}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />{' '}
            ครั้ง/นาที
          </label>
          <span className="legend-item">
            <span className="legend-swatch" style={{ background: withAlpha(colors.focus, 0.65) }} />
            ปกติ
          </span>
          <span className="legend-item">
            <span className="legend-swatch" style={{ background: withAlpha(colors.focusOver, 0.75) }} />
            เกินกำหนด
          </span>
        </div>
      </SectionHeader>

      {overThreshold && (
        <div className="alert-bar" style={{ marginBottom: 10 }} role="alert">
          <span>⚠</span>
          <span>
            ขยับ {mvPerMin} ครั้ง/นาที — เกินที่กำหนดไว้ {threshold} ครั้ง!
          </span>
        </div>
      )}

      <div className="focus-grid">
        <div className="focus-main">
          <div className="panel">
            <div className="panel-title">การเคลื่อนไหวต่อนาที (รวม 4 ช่วง × 15 วินาที)</div>
            <div className="panel-meta" style={{ margin: '4px 0 8px' }}>
              {buckets.length
                ? `${Math.min(buckets.length, maxBars)} นาทีล่าสุด · ${rows.length} รายการ · เกณฑ์ ${threshold} ครั้ง/นาที`
                : '— รอข้อมูล —'}
            </div>
            <div className="focus-chart-stage">
              <FocusChart
                key={theme}
                buckets={buckets}
                threshold={threshold}
                colors={colors}
                maxBars={maxBars}
              />
            </div>
          </div>
          <div className="panel">
            <div className="panel-title gov-card-title">
              <BookOpen size={15} strokeWidth={2.2} aria-hidden /> ความหมายของข้อมูล
            </div>
            <div className="glossary">
              {GLOSSARY.map(([key, desc]) => (
                <div key={key} className="glossary-row">
                  <span className="glossary-key">{key}</span>
                  <span className="glossary-desc">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="focus-cards">
          <div className="panel">
            <div className="fcard-label">
              <span>การเคลื่อนไหว / นาที</span>
              <span className={`badge ${overThreshold ? 'danger' : mvPerMin != null ? '' : 'nodata'}`}>
                {mvPerMin == null ? '—' : overThreshold ? 'สูงเกิน!' : 'ปกติ'}
              </span>
            </div>
            <div className="fcard-val">{mvPerMin ?? '--'}</div>
            <div className="fcard-sub">
              รวม 4 ช่วง × 15 วินาทีล่าสุด
              <br />
              เกณฑ์แจ้งเตือน: {threshold} ครั้ง/นาที
            </div>
          </div>

          <div className="panel">
            <div className="fcard-label">
              <span>จำนวนใบหน้า</span>
            </div>
            <div
              className="fcard-val"
              style={{
                color:
                  faceCount == null
                    ? 'var(--muted)'
                    : faceCount === 0
                      ? 'var(--lv-danger)'
                      : faceCount > 1
                        ? 'var(--lv-warning)'
                        : 'var(--c-hum)',
              }}
            >
              {faceCount ?? '--'}
            </div>
            <div className="fcard-sub">
              {faceCount == null
                ? 'จำนวนใบหน้าที่ตรวจพบล่าสุด'
                : faceCount === 0
                  ? 'ไม่พบใบหน้า'
                  : faceCount === 1
                    ? 'ตรวจพบ 1 คน'
                    : `ตรวจพบ ${faceCount} คน`}
            </div>
          </div>

          <div className="panel">
            <div className="fcard-label">
              <span>ทิศทางที่หัน (15 วินาทีล่าสุด)</span>
            </div>
            <div className="dir-grid">
              {DIRECTIONS.map(([key, label]) => {
                const v = Number(dir?.[key]) || 0;
                return (
                  <div key={key}>
                    <div className="dir-label">{label}</div>
                    <div className="dir-val">{dir ? v : '--'}</div>
                    <div className="dir-bar">
                      <div className="dir-fill" style={{ width: `${Math.round((v / dirTotal) * 100)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
