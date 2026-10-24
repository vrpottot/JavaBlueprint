import type { IncomingMessage, ServerResponse } from 'node:http';

type Request = IncomingMessage & { query?: Record<string, string | string[]>; body?: unknown };
// Same-origin gateway: the secret stays in Vercel, never in the Vite bundle.
export default async function handler(request: Request, response: ServerResponse) {
  response.setHeader('Cache-Control', 'no-store');
  const upstream = process.env.BACKEND_URL;
  const key = process.env.BACKEND_API_KEY;
  if (!upstream || !key) {
    response.statusCode = 503;
    return response.end(JSON.stringify({ error: { code: 'GATEWAY_UNCONFIGURED', message: 'API gateway is not configured' } }));
  }
  const original = new URL(request.url || '/', 'http://gateway');
  const route = request.query?.path;
  const path = Array.isArray(route) ? route.join('/') : route || original.pathname.replace(/^\/api\//, '');
  if (!/^(health|projects(?:\/[A-Za-z0-9-]+)*(?:\/[a-z-]+)?)$/.test(path)) {
    response.statusCode = 404;
    return response.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Unknown API route' } }));
  }
  if (!['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'].includes(request.method || '')) {
    response.statusCode = 405;
    return response.end();
  }
  try {
    let body: string | undefined;
    if (!['GET', 'OPTIONS'].includes(request.method || '')) {
      if (request.body !== undefined) body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
      else {
        const chunks: Buffer[] = []; let size = 0;
        for await (const raw of request) {
          const chunk = Buffer.from(raw); size += chunk.length;
          if (size > 4 * 1024 * 1024) { response.statusCode = 413; return response.end(); }
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks).toString('utf8') || undefined;
      }
      if (body && Buffer.byteLength(body) > 4 * 1024 * 1024) { response.statusCode = 413; return response.end(); }
    }
    const result = await fetch(`${upstream.replace(/\/$/, '')}/api/${path}`, {
      method: request.method, body,
      headers: { 'Content-Type': 'application/json', 'X-Backend-Key': key },
      signal: AbortSignal.timeout(240000), redirect: 'error',
    });
    response.statusCode = result.status;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (result.status === 204) return response.end();
    if (!result.headers.get('content-type')?.includes('application/json')) throw new Error('Invalid backend response');
    const data = Buffer.from(await result.arrayBuffer());
    if (data.length > 4 * 1024 * 1024) {
      response.statusCode = 413;
      return response.end(JSON.stringify({ error: { code: 'RESPONSE_LIMIT', message: 'Project is too large for the web gateway; split it into smaller files' } }));
    }
    return response.end(data);
  } catch {
    response.statusCode = 502;
    return response.end(JSON.stringify({ error: { code: 'BACKEND_UNAVAILABLE', message: 'Backend is unavailable; retry shortly' } }));
  }
}
