/**
 * Minimal Supabase REST (PostgREST) client — server-side only.
 * Uses plain fetch so there is no SDK dependency to keep in sync.
 */
import config from '@/config';

function baseHeaders() {
  const { anonKey } = config.supabase;
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    'Content-Type': 'application/json',
  };
}

export function supabaseConfigured() {
  return Boolean(config.supabase.url && config.supabase.anonKey);
}

/**
 * Perform a REST call against /rest/v1/<pathAndQuery>.
 * Returns parsed JSON (array for selects) or throws with status context.
 */
export async function sbRequest(pathAndQuery, { method = 'GET', body, headers = {} } = {}) {
  const url = `${config.supabase.url}/rest/v1/${pathAndQuery}`;
  const res = await fetch(url, {
    method,
    headers: { ...baseHeaders(), ...headers },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(config.supabase.timeoutMs),
    cache: 'no-store',
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase ${method} ${res.status}: ${detail.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

/** SELECT helper — params is a plain object of PostgREST query params. */
export async function selectRows(table, params = {}) {
  const q = new URLSearchParams({ select: '*', ...params });
  return sbRequest(`${table}?${q.toString()}`);
}

/** INSERT one row, returning the stored representation. */
export async function insertRow(table, row) {
  const rows = await sbRequest(table, {
    method: 'POST',
    body: row,
    headers: { Prefer: 'return=representation' },
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

/** Cheap connectivity probe: select a single id from the readings table. */
export async function pingSupabase() {
  if (!supabaseConfigured()) return false;
  try {
    await selectRows(config.supabase.envTable, { select: 'id', limit: '1' });
    return true;
  } catch {
    return false;
  }
}
