import { absoluteApiUrl, ApiError, desktopFetchJson, isOwnApiUrl, publicFetchJson } from './apiClient';
import type { ApiRequest, ApiResult } from './types';

const ID = '[A-Za-z0-9_-]{1,64}';

// The renderer never sees the access token. It asks the main process to make a request, and
// only these Pulse Convert endpoints (the same ones the website's own pages use) are allowed.
const ROUTES: Array<{ method: ApiRequest['method']; pattern: RegExp; auth: boolean }> = [
  { method: 'GET', pattern: /^\/api\/jobs$/, auth: true },
  { method: 'GET', pattern: new RegExp(`^/api/jobs/${ID}$`), auth: true },
  { method: 'DELETE', pattern: new RegExp(`^/api/jobs/${ID}$`), auth: true },
  { method: 'POST', pattern: new RegExp(`^/api/jobs/${ID}/(rerun|verify)$`), auth: true },
  { method: 'GET', pattern: /^\/api\/account$/, auth: true },
  { method: 'POST', pattern: /^\/api\/account\/notifications$/, auth: true },
  { method: 'DELETE', pattern: new RegExp(`^/api/desktop/devices/${ID}$`), auth: true },
  { method: 'GET', pattern: /^\/api\/queue$/, auth: true },
  { method: 'GET', pattern: /^\/api\/queue\/public$/, auth: false },
  { method: 'GET', pattern: /^\/api\/stats\/live$/, auth: false },
  { method: 'GET', pattern: /^\/api\/stats\/history$/, auth: false },
  { method: 'GET', pattern: /^\/api\/catalog\/showcase$/, auth: false },
  { method: 'GET', pattern: /^\/api\/public-stats$/, auth: false },
  { method: 'GET', pattern: /^\/api\/gallery$/, auth: false },
  { method: 'GET', pattern: /^\/api\/catalog\/vehicles\/list$/, auth: true },
  { method: 'GET', pattern: /^\/api\/catalog\/animations\/list$/, auth: true },
  { method: 'GET', pattern: /^\/api\/catalog-content\/list$/, auth: true },
  { method: 'POST', pattern: new RegExp(`^/api/(vehicles|animations|catalog-content)/${ID}/favorite$`), auth: true },
  { method: 'POST', pattern: /^\/api\/tools\/collisions$/, auth: true },
  { method: 'GET', pattern: /^\/api\/tools\/available$/, auth: true },
];

export async function proxyApiRequest(value: unknown): Promise<ApiResult> {
  try {
    if (typeof value !== 'object' || value === null) throw new ApiError('Invalid request.', 400);
    const { method, path, body } = value as ApiRequest;
    if (typeof path !== 'string' || path.length > 2048) throw new ApiError('Invalid request path.', 400);

    const url = absoluteApiUrl(path);
    if (!isOwnApiUrl(url)) throw new ApiError('Requests can only go to Pulse Convert.', 400);
    const route = ROUTES.find((candidate) => candidate.method === method && candidate.pattern.test(url.pathname));
    if (!route) throw new ApiError(`Not an allowed request: ${method} ${url.pathname}`, 403);

    const relative = `${url.pathname}${url.search}`;
    if (!route.auth) return { ok: true, data: await publicFetchJson(relative) };

    const init: RequestInit = { method };
    if (method === 'POST') {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body ?? {});
    }
    return { ok: true, data: await desktopFetchJson(relative, init) };
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 0;
    const message = status === 0 ? `Could not reach Pulse Convert: ${(err as Error).message}` : (err as Error).message;
    return { ok: false, error: message, status };
  }
}
