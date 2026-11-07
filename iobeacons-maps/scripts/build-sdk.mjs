// Writes the IoBeacons client libraries from the endpoint list in src/openapi.js:
//   sdk/js/iobeacons.mjs (+ .d.ts)   JavaScript for Node 18+, Deno, Bun and browsers
//   sdk/python/iobeacons.py          Python 3.8+, standard library only
// Run: node scripts/build-sdk.mjs   (npm run build does it too)
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENDPOINTS } from '../src/openapi.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '1.0.0';
const BASE = 'https://iobeacons.com/maps/api/v1';

const ops = ENDPOINTS.map(([method, p, tag, summary, d = {}]) => {
  const params = d.params || [];
  return {
    method: method.toUpperCase(), path: p, tag, summary, op: d.op,
    pathArgs: params.filter((x) => x.in === 'path').map((x) => x.name),
    query: params.filter((x) => x.in === 'query').map((x) => x.name),
    body: Boolean(d.body), upload: Boolean(d.upload), raw: Boolean(d.raw),
    example: d.body,
  };
});
const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const jsArg = (n) => (n === 'format' ? 'format' : n);

// ---------------- JavaScript ----------------
function jsMethod(o) {
  const args = [...o.pathArgs.map(jsArg)];
  if (o.upload) args.push('file', 'name');
  else if (o.body) args.push('body');
  if (o.query.length) args.push('query = {}');
  const url = '`' + o.path.replace(/\{(\w+)\}/g, (_, n) => '${enc(' + jsArg(n) + ')}') + '`';
  const opts = [o.body && 'body', o.query.length && 'query', o.raw && 'raw: true'].filter(Boolean);
  const call = o.upload
    ? `this._upload(${url}, file, name)`
    : `this.request('${o.method}', ${url}${opts.length ? `, { ${opts.join(', ')} }` : ''})`;
  const doc = [`  /** ${o.summary}. ${o.method} ${o.path}`];
  if (o.query.length) doc.push(`   *  query: ${o.query.join(', ')}`);
  if (o.example) doc.push(`   *  @example io.${o.op}(${[...o.pathArgs.map((a) => `'${a}'`), JSON.stringify(o.example)].join(', ')})`);
  doc.push('   */');
  return `${doc.join('\n')}\n  ${o.op}(${args.join(', ')}) { return ${call}; }`;
}

const js = `// IoBeacons API client ${VERSION}. Generated from the API description; do not edit by hand.
// Docs: https://iobeacons.com/developers/api/
//
//   import { IoBeacons } from './iobeacons.mjs';
//   const io = new IoBeacons(process.env.IOBEACONS_API_KEY);
//   await io.sendPositions('truck-12', { lon: -95.99, lat: 36.15, speed_mph: 34 });
//   const iss = await io.satellitePosition(25544);

export const VERSION = '${VERSION}';
const enc = encodeURIComponent;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Thrown for any answer that is not a success. message is safe to show a person. */
export class IoBeaconsError extends Error {
  constructor(status, message, body) { super(message); this.name = 'IoBeaconsError'; this.status = status; this.body = body; }
}

export class IoBeacons {
  /**
   * @param {string} apiKey  Your key (iobm_...). Create one in Maps under Settings, API keys.
   * @param {{ baseUrl?: string, retries?: number, fetch?: typeof fetch }} [options]
   */
  constructor(apiKey, options = {}) {
    if (!apiKey || !String(apiKey).startsWith('iobm_')) throw new Error('IoBeacons: pass your API key (it starts with iobm_).');
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl || '${BASE}').replace(/\\/$/, '');
    this.retries = options.retries ?? 2;
    this._fetch = options.fetch || globalThis.fetch.bind(globalThis);
    /** Quota from the last answer: { limit, remaining, period }. */
    this.quota = null;
  }

  /** Call any endpoint. path is relative to the API root, for example '/maps'. */
  async request(method, path, { body, query, raw = false, form } = {}) {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const headers = { Authorization: \`Bearer \${this.apiKey}\`, 'X-Client': \`iobeacons-js/\${VERSION}\` };
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    for (let attempt = 0; ; attempt++) {
      let res;
      try { res = await this._fetch(url, { method, headers, body: payload }); } catch (e) {
        if (attempt < this.retries && method === 'GET') { await sleep(500 * 2 ** attempt); continue; }
        throw new IoBeaconsError(0, \`Could not reach IoBeacons: \${e.message}\`);
      }
      const limit = res.headers.get('x-quota-limit');
      if (limit) this.quota = { limit: Number(limit), remaining: Number(res.headers.get('x-quota-remaining')), period: res.headers.get('x-quota-period') };
      const retryable = res.status === 429 || res.status === 502 || res.status === 503;
      if (retryable && attempt < this.retries && (method === 'GET' || res.status === 429) && res.headers.get('x-quota-remaining') !== '0') {
        await sleep(1000 * 2 ** attempt); continue;
      }
      if (!res.ok) {
        let data = null; try { data = await res.json(); } catch { /* not JSON */ }
        throw new IoBeaconsError(res.status, data?.error || \`IoBeacons answered \${res.status}\`, data);
      }
      if (raw) return res.arrayBuffer();
      return (res.headers.get('content-type') || '').includes('json') ? res.json() : res.text();
    }
  }

  _upload(path, file, name) {
    const form = new FormData();
    const ext = { 'application/json': 'geojson', 'application/geo+json': 'geojson', 'text/csv': 'csv', 'application/vnd.google-earth.kml+xml': 'kml', 'application/gpx+xml': 'gpx', 'application/zip': 'zip' }[file.type] || 'geojson';
    form.append('file', file, file.name || \`upload.\${ext}\`);
    if (name) form.append('name', name);
    return this.request('POST', path, { form });
  }

${ops.map(jsMethod).join('\n\n')}
}

export default IoBeacons;
`;

const dts = `// Types for the IoBeacons API client ${VERSION}.
export declare const VERSION: string;
export declare class IoBeaconsError extends Error { status: number; body: unknown; }
type Q = Record<string, string | number | boolean | undefined>;
export declare class IoBeacons {
  constructor(apiKey: string, options?: { baseUrl?: string; retries?: number; fetch?: typeof fetch });
  apiKey: string; baseUrl: string; retries: number;
  quota: { limit: number; remaining: number; period: string } | null;
  request<T = any>(method: string, path: string, opts?: { body?: unknown; query?: Q; raw?: boolean; form?: FormData }): Promise<T>;
${ops.map((o) => {
    const a = o.pathArgs.map((n) => `${jsArg(n)}: string | number`);
    if (o.upload) a.push('file: Blob', 'name?: string');
    else if (o.body) a.push('body: Record<string, unknown>');
    if (o.query.length) a.push(`query?: { ${o.query.map((q) => `${q}?: string | number`).join('; ')} }`);
    return `  /** ${o.summary} */\n  ${o.op}(${a.join(', ')}): Promise<${o.raw ? 'ArrayBuffer' : 'any'}>;`;
  }).join('\n')}
}
export default IoBeacons;
`;

// ---------------- Python ----------------
function pyMethod(o) {
  const name = snake(o.op);
  const args = ['self', ...o.pathArgs.map(snake)];
  if (o.upload) args.push('file_path', 'name=None');
  else if (o.body) args.push('body');
  for (const q of o.query) args.push(`${q}=None`);
  const url = 'f"' + o.path.replace(/\{(\w+)\}/g, (_, n) => `{_q(${snake(n)})}`) + '"';
  const lines = [`    def ${name}(${args.join(', ')}):`, `        """${o.summary}. ${o.method} ${o.path}"""`];
  if (o.upload) lines.push(`        return self._upload(${url}, file_path, name)`);
  else {
    const kw = [];
    if (o.body) kw.push('body=body');
    if (o.query.length) kw.push(`query={${o.query.map((q) => `"${q}": ${q}`).join(', ')}}`);
    if (o.raw) kw.push('raw=True');
    lines.push(`        return self.request("${o.method}", ${url}${kw.length ? ', ' + kw.join(', ') : ''})`);
  }
  return lines.join('\n');
}

const py = `"""IoBeacons API client ${VERSION}. Generated from the API description; do not edit by hand.

Docs: https://iobeacons.com/developers/api/
Needs only the Python standard library (3.8+).

    from iobeacons import IoBeacons
    io = IoBeacons("iobm_...")          # or set IOBEACONS_API_KEY
    io.send_positions("truck-12", {"lon": -95.99, "lat": 36.15, "speed_mph": 34})
    iss = io.satellite_position(25544)
"""
import json
import mimetypes
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

__version__ = "${VERSION}"
__all__ = ["IoBeacons", "IoBeaconsError"]


def _q(v):
    return urllib.parse.quote(str(v), safe="")


class IoBeaconsError(Exception):
    """Raised for any answer that is not a success. str(e) is safe to show a person."""

    def __init__(self, status, message, body=None):
        super().__init__(message)
        self.status = status
        self.body = body


class IoBeacons:
    """A client for the IoBeacons API. Create a key in Maps under Settings, API keys."""

    def __init__(self, api_key=None, base_url="${BASE}", retries=2, timeout=30):
        api_key = api_key or os.environ.get("IOBEACONS_API_KEY")
        if not api_key or not api_key.startswith("iobm_"):
            raise ValueError("IoBeacons: pass your API key (it starts with iobm_) or set IOBEACONS_API_KEY.")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.retries = retries
        self.timeout = timeout
        self.quota = None  # {"limit", "remaining", "period"} from the last answer

    def request(self, method, path, body=None, query=None, raw=False, data=None, content_type=None):
        """Call any endpoint. path is relative to the API root, for example "/maps"."""
        url = self.base_url + path
        if query:
            q = {k: v for k, v in query.items() if v is not None}
            if q:
                url += "?" + urllib.parse.urlencode(q)
        headers = {"Authorization": "Bearer " + self.api_key, "X-Client": "iobeacons-python/" + __version__, "Accept": "application/json"}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        elif content_type:
            headers["Content-Type"] = content_type
        attempt = 0
        while True:
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as res:
                    self._quota(res.headers)
                    payload = res.read()
                    if raw:
                        return payload
                    if "json" in (res.headers.get("Content-Type") or ""):
                        return json.loads(payload.decode("utf-8"))
                    return payload.decode("utf-8")
            except urllib.error.HTTPError as e:
                self._quota(e.headers)
                retry = e.code in (429, 502, 503) and attempt < self.retries and (method == "GET" or e.code == 429) and e.headers.get("X-Quota-Remaining") != "0"
                if retry:
                    time.sleep(2 ** attempt)
                    attempt += 1
                    continue
                try:
                    detail = json.loads(e.read().decode("utf-8"))
                except Exception:
                    detail = None
                message = (detail or {}).get("error") or "IoBeacons answered %d" % e.code
                raise IoBeaconsError(e.code, message, detail) from None
            except urllib.error.URLError as e:
                if method == "GET" and attempt < self.retries:
                    time.sleep(0.5 * 2 ** attempt)
                    attempt += 1
                    continue
                raise IoBeaconsError(0, "Could not reach IoBeacons: %s" % e.reason) from None

    def _quota(self, headers):
        if headers and headers.get("X-Quota-Limit"):
            self.quota = {"limit": int(headers["X-Quota-Limit"]), "remaining": int(headers.get("X-Quota-Remaining") or 0), "period": headers.get("X-Quota-Period")}

    def _upload(self, path, file_path, name=None):
        boundary = uuid.uuid4().hex
        filename = os.path.basename(file_path)
        ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        with open(file_path, "rb") as f:
            content = f.read()
        parts = []
        if name:
            parts.append(('--%s\\r\\nContent-Disposition: form-data; name="name"\\r\\n\\r\\n%s\\r\\n' % (boundary, name)).encode("utf-8"))
        parts.append(('--%s\\r\\nContent-Disposition: form-data; name="file"; filename="%s"\\r\\nContent-Type: %s\\r\\n\\r\\n' % (boundary, filename, ctype)).encode("utf-8"))
        parts.append(content + ("\\r\\n--%s--\\r\\n" % boundary).encode("utf-8"))
        return self.request("POST", path, data=b"".join(parts), content_type="multipart/form-data; boundary=" + boundary)

${ops.map(pyMethod).join('\n\n')}
`;

await mkdir(path.join(root, 'sdk/js'), { recursive: true });
await mkdir(path.join(root, 'sdk/python'), { recursive: true });
await writeFile(path.join(root, 'sdk/js/iobeacons.mjs'), js);
await writeFile(path.join(root, 'sdk/js/iobeacons.d.ts'), dts);
await writeFile(path.join(root, 'sdk/python/iobeacons.py'), py);
export const SDK_OPS = ops;
console.log(`SDK: ${ops.length} endpoints written to sdk/js and sdk/python`);
