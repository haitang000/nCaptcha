import fs from 'node:fs/promises';
import { getClientIp, readJson, sendJson } from './http.js';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/landing/styles.css', ['landing/styles.css', 'text/css; charset=utf-8']],
  ['/landing/app.js', ['landing/app.js', 'text/javascript; charset=utf-8']],
  ['/landing/favicon.svg', ['landing/favicon.svg', 'image/svg+xml']],
]);

/** The public demo consumes only landing-demo tokens, never business tokens. */
export async function serveLanding(req, res, { captcha, allowedOrigins = [] } = {}) {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/demo/verify' && captcha) {
    if (req.method !== 'POST') { sendJson(res, 405, { error: '请使用 POST', code: 'METHOD_NOT_ALLOWED' }); return true; }
    if (!allowedOrigins.includes(req.headers.origin)) { sendJson(res, 403, { error: '该来源未获准访问', code: 'ORIGIN_DENIED' }); return true; }
    const { token } = await readJson(req);
    const success = await captcha.consumeToken({ token, ip: getClientIp(req), action: 'landing-demo' });
    sendJson(res, success ? 200 : 400, success ? { success: true } : { success: false, error: '令牌无效或已过期，请重新验证' });
    return true;
  }
  if (!['GET', 'HEAD'].includes(req.method) || !assets.has(path)) return false;
  const [file, type] = assets.get(path);
  const content = await fs.readFile(new URL('../dist/' + file, import.meta.url));
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  res.end(req.method === 'HEAD' ? undefined : content);
  return true;
}
