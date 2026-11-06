import { config } from '../config.js';
import { one, q } from '../db/pool.js';

// Fetches an outside data source with a timeout and a shared database cache,
// so many viewers cost one upstream request and slow sources can't hang a page.
export class UpstreamError extends Error {}

export async function fetchCached(key, url, { ttlSec = 300, timeoutMs = 12000, headers = {}, method = 'GET', body } = {}) {
  const hit = await one('select status, content_type, body from http_cache where key=$1 and expires_at > now()', [key]);
  if (hit) return { status: hit.status, contentType: hit.content_type, body: hit.body, cached: true };
  if (config.offline) throw new UpstreamError('Outside data sources are switched off on this server.');
  let res;
  try {
    res = await fetch(url, {
      method, body,
      headers: { 'User-Agent': config.userAgent, Accept: '*/*', ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new UpstreamError(`Couldn't reach ${new URL(url).host}: ${e.name === 'TimeoutError' ? 'timed out' : e.message}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  if (res.ok) {
    await q(`insert into http_cache(key, status, content_type, body, expires_at) values ($1,$2,$3,$4, now() + make_interval(secs => $5))
             on conflict (key) do update set status=excluded.status, content_type=excluded.content_type, body=excluded.body, expires_at=excluded.expires_at`,
    [key, res.status, contentType, buf, ttlSec]);
  }
  return { status: res.status, contentType, body: buf, cached: false };
}

export async function fetchJson(key, url, opts) {
  const r = await fetchCached(key, url, opts);
  if (r.status >= 400) throw new UpstreamError(`${new URL(url).host} answered ${r.status}`);
  try { return JSON.parse(r.body.toString('utf8')); } catch { throw new UpstreamError(`${new URL(url).host} sent data we couldn't read`); }
}

export async function pruneCache() {
  await q('delete from http_cache where expires_at < now()');
}
