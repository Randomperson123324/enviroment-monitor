/**
 * Government water feeds — direct port of StreeFlood's lib/gov/*
 * fetchers (ThaiWater/HII · RID). env-monitor used to proxy the deployed
 * StreeFlood site's /api/gov, but Vercel's bot challenge answers server-to-
 * server requests with HTTP 429, so the agency feeds are fetched directly.
 * The assembled payload follows StreeFlood's shape, less its two
 * meteorological sections (TMD announcements and daily forecast), which this
 * app no longer carries.
 *
 * Upstream responses are cached via Next's fetch revalidation because the
 * rainfall feed is ~4.5 MB — every visitor hitting it directly would be both
 * slow and rude to a free government service.
 */
import config from '@/config';

const cacheOpts = () => ({ next: { revalidate: config.gov.revalidateSeconds } });

// ── ThaiWater/HII: warnings, 24h rainfall, river levels (api-v3.thaiwater.net) ──

/** Each feed entry's `message` is a batch of alerts following the grammar
 * "[เสี่ยงเกิดน้ำท่วมฉับพลัน] ฝนตกหนัก(มาก) สถานี<station> ต.<tambon> อ.<amphoe>
 * จ.<province> ฝน<window>[<range>] <amount> มม." — parsed so the UI can show
 * scannable cards instead of raw text walls. */
const WARNING_ALERT_RE =
  /^(?:\[(.+?)\]\s*)?(ฝนตกหนักมาก|ฝนตกหนัก)\s+สถานี(.+?)\s+ต\.(\S+)\s+อ\.(\S+)\s+จ\.(\S+)\s+ฝน(.+?)\[(.+?)\]\s*([\d.]+)\s*มม/;

function parseWarningAlert(segment, datetime) {
  const m = segment.match(WARNING_ALERT_RE);
  if (!m) {
    return {
      datetime,
      flashFloodRisk: false,
      veryHeavy: false,
      station: '',
      tambon: '',
      amphoe: '',
      province: '',
      periodType: '',
      periodRange: '',
      amountMm: 0,
      raw: segment,
      parsed: false,
    };
  }
  return {
    datetime,
    flashFloodRisk: Boolean(m[1]),
    veryHeavy: m[2] === 'ฝนตกหนักมาก',
    station: m[3],
    tambon: m[4],
    amphoe: m[5],
    province: m[6],
    periodType: m[7],
    periodRange: m[8],
    amountMm: Number(m[9]),
    raw: segment,
    parsed: true,
  };
}

async function fetchGovWarnings() {
  const res = await fetch(`${config.gov.thaiwaterBase}/warning`, cacheOpts());
  if (!res.ok) throw new Error(`ThaiWater warning API error: ${res.status}`);

  const json = await res.json();
  return (json.data ?? [])
    .filter((w) => w.message)
    .flatMap((w) =>
      w.message
        .split(/\n{2,}/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((segment) => parseWarningAlert(segment, w.datetime))
    );
}

function toGovRainStation(s) {
  return {
    stationName: s.station?.tele_station_name?.th ?? s.station?.tele_station_name?.en ?? '',
    province: {
      th: s.geocode?.province_name?.th ?? '',
      en: s.geocode?.province_name?.en ?? s.geocode?.province_name?.th ?? '',
    },
    amphoe: {
      th: s.geocode?.amphoe_name?.th ?? '',
      en: s.geocode?.amphoe_name?.en ?? s.geocode?.amphoe_name?.th ?? '',
    },
    agency: {
      th: s.agency?.agency_name?.th ?? '',
      en: s.agency?.agency_name?.en ?? s.agency?.agency_name?.th ?? '',
    },
    rain24h: s.rain_24h ?? 0,
    datetime: s.rainfall_datetime,
  };
}

async function fetchTopRainfall() {
  const res = await fetch(`${config.gov.thaiwaterBase}/rain_24h`, cacheOpts());
  if (!res.ok) throw new Error(`ThaiWater rain API error: ${res.status}`);

  const json = await res.json();
  return (json.data ?? [])
    .filter((s) => typeof s.rain_24h === 'number' && s.rain_24h > 0)
    .sort((a, b) => (b.rain_24h ?? 0) - (a.rain_24h ?? 0))
    .slice(0, config.gov.rainTopStations)
    .map(toGovRainStation);
}

/** ThaiWater's official 5-step situation scale for river stations:
 * 1 = critically low … 3 = normal, 4 = high (น้ำมาก), 5 = overflowing (ล้นตลิ่ง). */
const RIVER_HIGH_LEVEL = 4;
const RIVER_OVERFLOW_LEVEL = 5;

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toGovRiverStation(s) {
  return {
    stationName: s.station?.tele_station_name?.th ?? s.station?.tele_station_name?.en ?? '',
    river: s.river_name ?? '',
    province: {
      th: s.geocode?.province_name?.th ?? '',
      en: s.geocode?.province_name?.en ?? s.geocode?.province_name?.th ?? '',
    },
    amphoe: {
      th: s.geocode?.amphoe_name?.th ?? '',
      en: s.geocode?.amphoe_name?.en ?? s.geocode?.amphoe_name?.th ?? '',
    },
    waterlevelMsl: toNumber(s.waterlevel_msl),
    storagePercent: toNumber(s.storage_percent),
    situationLevel: s.situation_level,
    datetime: s.waterlevel_datetime,
  };
}

async function fetchRiverSituation() {
  const res = await fetch(`${config.gov.thaiwaterBase}/waterlevel_load`, cacheOpts());
  if (!res.ok) throw new Error(`ThaiWater waterlevel API error: ${res.status}`);

  const json = await res.json();
  const stations = (json.waterlevel_data?.data ?? []).filter(
    (s) => typeof s.situation_level === 'number'
  );

  const critical = stations
    .filter((s) => s.situation_level >= RIVER_HIGH_LEVEL)
    .map(toGovRiverStation)
    .sort(
      (a, b) =>
        b.situationLevel - a.situationLevel || (b.storagePercent ?? 0) - (a.storagePercent ?? 0)
    )
    .slice(0, config.gov.riverStations);

  return {
    totalStations: stations.length,
    overflowCount: stations.filter((s) => s.situation_level === RIVER_OVERFLOW_LEVEL).length,
    highCount: stations.filter((s) => s.situation_level === RIVER_HIGH_LEVEL).length,
    critical,
  };
}

// ── RID: reservoir storage (app.rid.go.th) ──

/** RID storage classification: >100% of capacity = over capacity (danger),
 * 81–100% = high water (น้ำมาก). Below that isn't a flood concern. */
const RESERVOIR_HIGH_PERCENT = 81;
const RESERVOIR_OVER_PERCENT = 100;

const REGION_EN = {
  ภาคเหนือ: 'North',
  ภาคตะวันออกเฉียงเหนือ: 'Northeast',
  ภาคกลาง: 'Central',
  ภาคตะวันออก: 'East',
  ภาคตะวันตก: 'West',
  ภาคใต้: 'South',
};

async function fetchRidFeed() {
  let lastError;
  for (let attempt = 0; attempt < config.gov.ridFetchAttempts; attempt++) {
    try {
      const res = await fetch(config.gov.ridReservoirUrl, cacheOpts());
      if (!res.ok) throw new Error(`RID reservoir API error: ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function flattenReservoirs(json) {
  return (json.data ?? []).flatMap((group) =>
    (group.reservoir ?? [])
      .filter((r) => typeof r.percent_storage === 'number' && typeof r.storage === 'number')
      .map((r) => ({
        id: r.id,
        name: r.name,
        region: { th: group.region, en: REGION_EN[group.region] ?? group.region },
        capacity: r.storage,
        volume: r.volume ?? 0,
        percentStorage: r.percent_storage,
        inflow: r.inflow,
        outflow: r.outflow,
      }))
  );
}

/** Last successful parse, served when every retry fails — reservoir data is
 * daily, so a stale copy beats an empty section. (Per-instance memory: lost
 * on cold start, which just falls back to the error state.) */
let lastGoodReservoirs = null;

async function fetchReservoirSituation() {
  let json;
  try {
    json = await fetchRidFeed();
  } catch (err) {
    if (lastGoodReservoirs) return lastGoodReservoirs;
    throw err;
  }

  const reservoirs = flattenReservoirs(json);
  const situation = {
    date: json.date ?? '',
    totalReservoirs: reservoirs.length,
    overCapacityCount: reservoirs.filter((r) => r.percentStorage > RESERVOIR_OVER_PERCENT).length,
    highCount: reservoirs.filter(
      (r) =>
        r.percentStorage >= RESERVOIR_HIGH_PERCENT && r.percentStorage <= RESERVOIR_OVER_PERCENT
    ).length,
    top: [...reservoirs]
      .sort((a, b) => b.percentStorage - a.percentStorage)
      .slice(0, config.gov.reservoirTop),
  };
  lastGoodReservoirs = situation;
  return situation;
}

// ── Assembled payload (same shape as StreeFlood's GET /api/gov) ──

/** Sections fail independently — one agency being down shouldn't blank the panel. */
export async function getGovData() {
  const [waterWarnings, riverSituation, rainfall, reservoirs] = await Promise.allSettled([
    fetchGovWarnings(),
    fetchRiverSituation(),
    fetchTopRainfall(),
    fetchReservoirSituation(),
  ]);

  for (const result of [waterWarnings, riverSituation, rainfall, reservoirs]) {
    if (result.status === 'rejected') console.error('[gov] source failed:', result.reason);
  }

  return {
    waterWarnings: waterWarnings.status === 'fulfilled' ? waterWarnings.value : null,
    riverSituation: riverSituation.status === 'fulfilled' ? riverSituation.value : null,
    rainfall: rainfall.status === 'fulfilled' ? rainfall.value : null,
    reservoirs: reservoirs.status === 'fulfilled' ? reservoirs.value : null,
    timestamp: new Date().toISOString(),
  };
}
