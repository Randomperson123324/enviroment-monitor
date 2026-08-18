'use client';

import { useState } from 'react';
import {
  Landmark,
  TriangleAlert,
  Waves,
  CloudRain,
  Droplets,
  ChevronDown,
  ShieldAlert,
  CircleCheck,
  CircleOff,
} from 'lucide-react';
import SectionHeader from '@/components/SectionHeader';
import { GOV_LEVELS } from '@/config/client';
import { agoFromTh } from '@/lib/format';
import { useLang } from '@/hooks/useLang';

function FeedDown() {
  const { t } = useLang();
  return (
    <p className="gov-empty">
      <CircleOff size={14} strokeWidth={2.2} aria-hidden /> {t('gov.feedDown')}
    </p>
  );
}

function AllClear({ text }) {
  return (
    <p className="gov-empty ok">
      <CircleCheck size={14} strokeWidth={2.2} aria-hidden /> {text}
    </p>
  );
}

/**
 * A place line that only repeats the station name carries no information —
 * many ThaiWater stations are named after their own province ("นครพนม" in
 * จ.นครพนม). Compare against the bare place, not the prefixed string, so this
 * works in both languages (Thai prefixes "จ.", English prefixes nothing).
 */
function placeLine(name, place, prefix = '') {
  if (!place) return '';
  return name?.includes(place) ? '' : `${prefix}${place}`;
}

/**
 * Count chips above a list — the section's headline numbers at a glance.
 * Number first, label under it: these are read as figures, and "อันตราย: 0"
 * put the label where the eye lands. A count of zero drops to the muted tone,
 * so a row of chips shows at a glance whether anything needs attention.
 */
function Chips({ items }) {
  return (
    <div className="gov-chips">
      {items.map((c) => (
        <span key={c.label} className={`gov-chip ${Number(c.value) > 0 ? c.tone ?? '' : 'zero'}`}>
          <b>{c.value}</b>
          <span>{c.label}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * One station / reservoir row, ported from StreeFlood's gov-data `DataRow`.
 *
 * Desktop: marker + name + value on the top line, location detail on its own
 * line below, always visible. Mobile: a compact single line with a chevron —
 * tapping un-truncates the name and reveals the detail, so nothing is lost on
 * a small screen without cramming it.
 */
function DataRow({ marker, title, subtitle, value, unit, tone, label, labelTone, tooltip }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li
      className={`gov-datarow ${expanded ? 'open' : ''}`}
      title={tooltip}
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
    >
      <div className="gov-datarow-main">
        <div className="gov-datarow-left">
          <span className={`gov-marker ${tone ?? ''}`}>{marker}</span>
          <p className="gov-datarow-title">{title}</p>
        </div>
        <div className="gov-datarow-right">
          <div>
            {/* Unit set apart from the figure, as in the sensor tiles: the
                numbers are what a reader scans down the column. */}
            <p className={`gov-datarow-value ${tone ?? ''}`}>
              {value}
              {unit ? <small>{unit}</small> : null}
            </p>
            {label ? <p className={`gov-datarow-label ${labelTone ?? ''}`}>{label}</p> : null}
          </div>
          <ChevronDown className="gov-datarow-chev" size={14} strokeWidth={2.2} aria-hidden />
        </div>
      </div>
      {subtitle ? <p className="gov-datarow-sub">{subtitle}</p> : null}
    </li>
  );
}

/**
 * Every row, in a scrolling list. Capping the height rather than the row count
 * keeps the four cards the same size regardless of how many alerts a feed
 * carries, and reaching the last of 64 warnings is a scroll instead of an
 * expand that reflows the whole grid.
 */
function RowList({ items, renderRow }) {
  return <ul className="gov-rows">{items.map(renderRow)}</ul>;
}

function GovCard({ Icon, title, children, wide }) {
  return (
    <div className={`panel gov-card ${wide ? 'gov-card-wide' : ''}`}>
      <div className="gov-card-title">
        <Icon size={15} strokeWidth={2.2} aria-hidden /> {title}
      </div>
      {children}
    </div>
  );
}

/** Government feeds shared from StreeFlood (presentational — data via useHydroFeed). */
export default function GovPanel({ feed }) {
  const { t } = useLang();
  const { data, error, loading } = feed;
  const warnings = data?.waterWarnings ?? null;
  const river = data?.riverSituation ?? null;
  const rain = data?.rainfall ?? null;
  const reservoirs = data?.reservoirs ?? null;

  return (
    <section className="section-gap">
      <SectionHeader
        Icon={Landmark}
        title={t('gov.title')}
        meta={
          error
            ? t('gov.metaErr')
            : data
              ? t('gov.meta', { ago: agoFromTh(data.timestamp) })
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
            <div className="panel flood-empty gov-card-wide">{t('gov.empty')}</div>
          )}
        </div>
      )}

      {data && (
        <div className="gov-grid">
          <GovCard Icon={TriangleAlert} title={t('gov.warnTitle')}>
            {warnings == null ? (
              <FeedDown />
            ) : warnings.length === 0 ? (
              <AllClear text={t('gov.warnNone')} />
            ) : (
              <>
                <Chips
                  items={[
                    {
                      label: t('gov.badgeFlash'),
                      value: warnings.filter((w) => w.flashFloodRisk).length,
                      tone: 'danger',
                    },
                    {
                      label: t('gov.warnVeryHeavy'),
                      value: warnings.filter((w) => w.veryHeavy).length,
                      tone: 'warning',
                    },
                    { label: t('gov.warnTotal'), value: warnings.length },
                  ]}
                />
                <RowList
                  // Most urgent first; the feed is already newest-first, which a
                  // stable sort preserves inside each tier.
                  items={[...warnings].sort(
                    (a, b) =>
                      Number(b.flashFloodRisk) - Number(a.flashFloodRisk) ||
                      Number(b.veryHeavy) - Number(a.veryHeavy)
                  )}
                  renderRow={(w, i) =>
                    w.parsed ? (
                      <DataRow
                        key={i}
                        tooltip={w.periodRange}
                        tone={w.flashFloodRisk || w.veryHeavy ? 'danger' : 'warning'}
                        marker={
                          w.flashFloodRisk ? (
                            <ShieldAlert size={16} strokeWidth={2.2} aria-hidden />
                          ) : (
                            <CloudRain size={16} strokeWidth={2.2} aria-hidden />
                          )
                        }
                        title={w.station}
                        subtitle={[
                          w.amphoe ? `${t('gov.amphoe')}${w.amphoe}` : '',
                          w.province ? `${t('gov.province')}${w.province}` : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                        value={Number(w.amountMm).toFixed(1)}
                        unit={t('gov.mm')}
                        label={w.flashFloodRisk ? t('gov.badgeFlash') : w.periodType}
                        labelTone={w.flashFloodRisk ? 'danger' : ''}
                      />
                    ) : (
                      // Unparseable alerts still carry the warning text verbatim.
                      <li key={i} className="gov-datarow raw">
                        {w.raw}
                      </li>
                    )
                  }
                />
              </>
            )}
          </GovCard>

          <GovCard Icon={Waves} title={t('gov.riverTitle')}>
            {river == null ? (
              <FeedDown />
            ) : (
              <>
                <Chips
                  items={[
                    { label: t('gov.riverOverflow'), value: river.overflowCount, tone: 'danger' },
                    { label: t('gov.riverHigh'), value: river.highCount, tone: 'warning' },
                    { label: t('gov.riverTotal'), value: river.totalStations },
                  ]}
                />
                {river.critical?.length ? (
                  <RowList
                    items={river.critical}
                    renderRow={(s, i) => {
                      const overflowing = s.situationLevel >= GOV_LEVELS.riverOverflow;
                      return (
                        <DataRow
                          key={i}
                          tone={overflowing ? 'danger' : 'warning'}
                          marker={<Waves size={16} strokeWidth={2.2} aria-hidden />}
                          title={s.stationName}
                          subtitle={[s.river, s.amphoe?.th, s.province?.th].filter(Boolean).join(' · ')}
                          value={overflowing ? t('gov.riverOverflow') : t('gov.riverHigh')}
                          label={
                            s.storagePercent != null
                              ? `${Number(s.storagePercent).toFixed(0)}% ${t('gov.bank')}`
                              : undefined
                          }
                        />
                      );
                    }}
                  />
                ) : (
                  <AllClear text={t('gov.riverNone')} />
                )}
              </>
            )}
          </GovCard>

          <GovCard Icon={CloudRain} title={t('gov.rainTitle')}>
            {rain == null ? (
              <FeedDown />
            ) : rain.length === 0 ? (
              <AllClear text={t('gov.rainNone')} />
            ) : (
              <RowList
                items={rain}
                renderRow={(r, i) => (
                  <DataRow
                    key={i}
                    // No tone: 24-hour rainfall is a measurement, not a state.
                    // It used to be drawn in the humidity series colour, which
                    // made a plain number look like a status of its own.
                    marker={<CloudRain size={16} strokeWidth={2.2} aria-hidden />}
                    title={r.stationName}
                    subtitle={placeLine(r.stationName, r.province?.th, t('gov.province'))}
                    value={Number(r.rain24h).toFixed(1)}
                    unit={t('gov.mm')}
                  />
                )}
              />
            )}
          </GovCard>

          <GovCard Icon={Droplets} title={t('gov.resTitle')}>
            {reservoirs == null ? (
              <FeedDown />
            ) : (
              <>
                <Chips
                  items={[
                    { label: t('gov.resOverCap'), value: reservoirs.overCapacityCount, tone: 'danger' },
                    { label: t('gov.resHigh'), value: reservoirs.highCount, tone: 'warning' },
                    { label: t('gov.resTotal'), value: reservoirs.totalReservoirs },
                  ]}
                />
                <RowList
                  items={reservoirs.top ?? []}
                  renderRow={(rv, i) => {
                    const pct = Number(rv.percentStorage);
                    return (
                      <DataRow
                        key={i}
                        tone={
                          pct > GOV_LEVELS.reservoirOverPercent
                            ? 'danger'
                            : pct >= GOV_LEVELS.reservoirHighPercent
                              ? 'warning'
                              : undefined
                        }
                        marker={<Droplets size={16} strokeWidth={2.2} aria-hidden />}
                        title={rv.name}
                        subtitle={placeLine(rv.name, rv.region?.th)}
                        value={pct.toFixed(0)}
                        unit="%"
                      />
                    );
                  }}
                />
              </>
            )}
          </GovCard>
        </div>
      )}
    </section>
  );
}
