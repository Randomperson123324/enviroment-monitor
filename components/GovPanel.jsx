'use client';

import { useState } from 'react';
import {
  Landmark,
  TriangleAlert,
  Waves,
  CloudRain,
  Droplets,
  Megaphone,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  CircleCheck,
  CircleOff,
} from 'lucide-react';
import SectionHeader from '@/components/SectionHeader';
import { GOV_COLLAPSED_ROWS } from '@/config/client';
import { agoFromTh } from '@/lib/format';

function FeedDown() {
  return (
    <div className="gov-muted gov-feed-down">
      <CircleOff size={13} strokeWidth={2.2} aria-hidden /> ฟีดนี้ขัดข้องชั่วคราว
    </div>
  );
}

function AllClear({ text }) {
  return (
    <div className="gov-ok">
      <CircleCheck size={14} strokeWidth={2.2} aria-hidden /> {text}
    </div>
  );
}

/** Collapsible list — shows GOV_COLLAPSED_ROWS rows with a "ดูทั้งหมด" toggle. */
function ExpandableList({ items, renderRow }) {
  const [open, setOpen] = useState(false);
  const visible = open ? items : items.slice(0, GOV_COLLAPSED_ROWS);
  return (
    <>
      {visible.map(renderRow)}
      {items.length > GOV_COLLAPSED_ROWS && (
        <button className="gov-expand" onClick={() => setOpen((v) => !v)}>
          {open ? (
            <>
              <ChevronUp size={14} strokeWidth={2.2} aria-hidden /> ย่อรายการ
            </>
          ) : (
            <>
              <ChevronDown size={14} strokeWidth={2.2} aria-hidden /> ดูทั้งหมด ({items.length})
            </>
          )}
        </button>
      )}
    </>
  );
}

function GovCard({ Icon, title, children }) {
  return (
    <div className="panel gov-card">
      <div className="gov-card-title">
        <Icon size={15} strokeWidth={2.2} aria-hidden /> {title}
      </div>
      {children}
    </div>
  );
}

/** Government feeds shared from StreeFlood (presentational — data via useHydroFeed). */
export default function GovPanel({ feed }) {
  const { data, error, loading } = feed;
  const warnings = data?.waterWarnings ?? null;
  const river = data?.riverSituation ?? null;
  const rain = data?.rainfall ?? null;
  const reservoirs = data?.reservoirs ?? null;
  const announcement = data?.announcements?.[0] ?? null;
  const forecast = data?.forecast ?? null;

  return (
    <section className="section-gap">
      <SectionHeader
        Icon={Landmark}
        title="ข้อมูลภาครัฐ (TMD · ThaiWater · กรมชลประทาน)"
        meta={
          error
            ? 'เชื่อมต่อ StreeFlood ไม่ได้ — แสดงข้อมูลล่าสุดที่มี'
            : data
              ? `แชร์จากเว็บ StreeFlood · อัปเดต${agoFromTh(data.timestamp)}`
              : ''
        }
      />

      {!data && (
        <div className="gov-grid">
          {loading ? (
            [1, 2, 3, 4].map((i) => (
              <div key={i} className="panel gov-card">
                <div className="skeleton" style={{ width: '60%', height: 15 }} />
                <div className="skeleton" style={{ width: '100%', height: 13, marginTop: 12 }} />
                <div className="skeleton" style={{ width: '85%', height: 13, marginTop: 8 }} />
                <div className="skeleton" style={{ width: '92%', height: 13, marginTop: 8 }} />
              </div>
            ))
          ) : (
            <div className="panel flood-empty gov-card-wide">
              ⚠️ ยังเชื่อมต่อ StreeFlood ไม่ได้ — จะลองใหม่อัตโนมัติ
            </div>
          )}
        </div>
      )}

      {data && (
        <div className="gov-grid">
          <GovCard Icon={TriangleAlert} title="เตือนฝนตกหนัก / น้ำท่วมฉับพลัน">
            {warnings == null ? (
              <FeedDown />
            ) : warnings.length === 0 ? (
              <AllClear text="ไม่มีประกาศเตือนขณะนี้" />
            ) : (
              <ExpandableList
                items={warnings}
                renderRow={(w, i) => (
                  <div key={i} className="gov-row">
                    <span className={`badge ${w.flashFloodRisk ? 'danger' : 'warning'}`}>
                      {w.flashFloodRisk ? 'น้ำท่วมฉับพลัน' : 'ฝนตกหนัก'}
                    </span>
                    <span className="gov-row-text" title={w.raw}>
                      {w.station ? `${w.station} ` : ''}จ.{w.province} · {w.amountMm} มม.
                      {w.periodRange ? ` (${w.periodRange})` : ''}
                    </span>
                  </div>
                )}
              />
            )}
          </GovCard>

          <GovCard Icon={Waves} title="สถานการณ์แม่น้ำ">
            {river == null ? (
              <FeedDown />
            ) : (
              <>
                <div className="gov-stats">
                  <div>
                    <b>สถานีทั้งหมด</b>
                    {river.totalStations}
                  </div>
                  <div style={{ color: river.overflowCount ? 'var(--lv-danger)' : undefined }}>
                    <b>ล้นตลิ่ง</b>
                    {river.overflowCount}
                  </div>
                  <div style={{ color: river.highCount ? 'var(--lv-warning)' : undefined }}>
                    <b>น้ำมาก</b>
                    {river.highCount}
                  </div>
                </div>
                {river.critical?.length ? (
                  <ExpandableList
                    items={river.critical}
                    renderRow={(s, i) => (
                      <div key={i} className="gov-row">
                        <span className="badge danger">วิกฤต</span>
                        <span className="gov-row-text">
                          {s.stationName} ({s.river}) จ.{s.province?.th ?? '-'}
                          {s.storagePercent != null ? ` · ${s.storagePercent}%` : ''}
                        </span>
                      </div>
                    )}
                  />
                ) : (
                  <AllClear text="ไม่มีสถานีระดับวิกฤต" />
                )}
              </>
            )}
          </GovCard>

          <GovCard Icon={CloudRain} title="ฝนสะสม 24 ชม. สูงสุด">
            {rain == null ? (
              <FeedDown />
            ) : rain.length === 0 ? (
              <AllClear text="ไม่มีข้อมูลฝนตกหนัก" />
            ) : (
              <ExpandableList
                items={rain}
                renderRow={(r, i) => (
                  <div key={i} className="gov-row">
                    <span className="gov-rain">{Number(r.rain24h).toFixed(1)} มม.</span>
                    <span className="gov-row-text">
                      {r.stationName} จ.{r.province?.th ?? '-'}
                    </span>
                  </div>
                )}
              />
            )}
          </GovCard>

          <GovCard Icon={Droplets} title="อ่างเก็บน้ำ / เขื่อน">
            {reservoirs == null ? (
              <FeedDown />
            ) : (
              <>
                <div className="gov-stats">
                  <div>
                    <b>ทั้งหมด</b>
                    {reservoirs.totalReservoirs}
                  </div>
                  <div
                    style={{ color: reservoirs.overCapacityCount ? 'var(--lv-danger)' : undefined }}
                  >
                    <b>เกินความจุ</b>
                    {reservoirs.overCapacityCount}
                  </div>
                  <div style={{ color: reservoirs.highCount ? 'var(--lv-warning)' : undefined }}>
                    <b>น้ำมาก</b>
                    {reservoirs.highCount}
                  </div>
                </div>
                <ExpandableList
                  items={reservoirs.top ?? []}
                  renderRow={(rv, i) => (
                    <div key={i} className="gov-row">
                      <span className="gov-rain">{Number(rv.percentStorage).toFixed(0)}%</span>
                      <span className="gov-row-text">{rv.name}</span>
                    </div>
                  )}
                />
              </>
            )}
          </GovCard>

          {(announcement || forecast) && (
            <div className="panel gov-card gov-card-wide">
              <div className="gov-card-title">
                <Megaphone size={15} strokeWidth={2.2} aria-hidden /> ประกาศ / พยากรณ์อากาศ
                (กรมอุตุนิยมวิทยา)
              </div>
              {announcement && (
                <div className="gov-row">
                  <span className="badge warning">ประกาศ</span>
                  <span className="gov-row-text">
                    {announcement.titleThai || announcement.titleEnglish}
                  </span>
                  {announcement.webUrlThai && (
                    <a
                      className="gov-link"
                      href={announcement.webUrlThai}
                      target="_blank"
                      rel="noreferrer"
                      title="อ่านประกาศฉบับเต็ม"
                    >
                      <ExternalLink size={13} strokeWidth={2.2} aria-hidden />
                    </a>
                  )}
                </div>
              )}
              {forecast?.overall?.th && <p className="gov-forecast">{forecast.overall.th}</p>}
              {forecast?.regions?.length ? (
                <div className="gov-regions">
                  <ExpandableList
                    items={forecast.regions}
                    renderRow={(rg, i) => (
                      <div key={i} className="gov-region-row">
                        <span className="gov-region-name">{rg.region?.th}</span>
                        <span className="gov-region-desc">{rg.description?.th}</span>
                      </div>
                    )}
                  />
                </div>
              ) : null}
              {forecast?.issuedText && <div className="gov-muted">{forecast.issuedText}</div>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
