import crypto from 'node:crypto';
import { isIP } from 'node:net';
import fs from 'node:fs/promises';
import { CaptchaError } from './error.js';

const assetNames = new Set(['captcha.js', 'captcha.esm.js', 'captcha.css', 'pow-worker.js']);
export function getClientIp(req, trustedProxies = []) {
  let ip = req.socket?.remoteAddress ?? '';
  const normalize = value => value.startsWith('::ffff:') && isIP(value.slice(7)) === 4 ? value.slice(7) : value;
  ip = normalize(ip);
  // 单层可信代理：只接受紧邻可信代理追加的最右侧地址，不信任客户端自报的首项。
  if (trustedProxies.map(normalize).includes(ip)) {
    const header = req.headers['x-forwarded-for'];
    const forwarded = typeof header === 'string' ? header.split(',').at(-1).trim() : '';
    if (isIP(forwarded)) ip = normalize(forwarded);
  }
  return ip;
}
export async function readJson(req, maxBytes = 65536) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new CaptchaError('CONTENT_TYPE', '请发送 application/json', 415);
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw new CaptchaError('CONTENT_ENCODING', '不支持压缩请求体', 415);
  if (req.body !== undefined) {
    if (Buffer.byteLength(JSON.stringify(req.body)) > maxBytes) throw new CaptchaError('BODY_TOO_LARGE', '请求体过大', 413);
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new CaptchaError('INVALID_JSON', 'JSON 必须为对象');
    return req.body;
  }
  let size = 0;
  const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > maxBytes) throw new CaptchaError('BODY_TOO_LARGE', '请求体过大', 413);
    parts.push(part);
  }
  try {
    const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new CaptchaError('INVALID_JSON', '请求 JSON 格式不正确'); }
}
export function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}
export function createHttpHandler(captcha, { basePath = '/captcha/v1', secret, allowedOrigins = [], trustedProxies = [], assetPath = '/captcha/assets', onError = console.error } = {}) {
  if (!/^\/(?:[\w-]+\/?)*$/.test(basePath) || basePath.endsWith('/') || !/^\/[\w/-]+$/.test(assetPath) || assetPath.endsWith('/')) throw new TypeError('basePath/assetPath 必须为不带末尾斜杠的绝对路径');
  if (secret !== undefined && (typeof secret !== 'string' || secret.length < 32 || secret.length > 1024)) throw new TypeError('secret 至少需要 32 个字符');
  if (!Array.isArray(allowedOrigins) || allowedOrigins.some(origin => { try { return new URL(origin).origin !== origin || !/^https?:/.test(origin); } catch { return true; } })) throw new TypeError('allowedOrigins 需为精确的 HTTP(S) origin 列表');
  if (!Array.isArray(trustedProxies) || trustedProxies.some(ip => typeof ip !== 'string' || !isIP(ip))) throw new TypeError('trustedProxies 需为代理 IP 列表');
  return async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://captcha.internal');
      const isApi = url.pathname === basePath || url.pathname.startsWith(basePath + '/');
      const asset = url.pathname.startsWith(assetPath + '/') ? url.pathname.slice(assetPath.length + 1) : '';
      if (!isApi && !assetNames.has(asset)) return false;
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Vary', 'Origin');
      const origin = req.headers.origin;
      // 同源浏览器请求也可能带 Origin，接入方需将自身 origin 一并列入白名单。
      if (origin && !allowedOrigins.includes(origin)) throw new CaptchaError('ORIGIN_DENIED', '该来源未获准访问', 403);
      if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
      const route = url.pathname.slice(basePath.length);
      if (req.method === 'OPTIONS') {
        if (!origin || !allowedOrigins.includes(origin) || route === '/siteverify') throw new CaptchaError('ORIGIN_DENIED', '该来源未获准访问', 403);
        const wantedHeaders = String(req.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
        if (wantedHeaders.some(h => h !== 'content-type') || !['GET', 'POST'].includes(req.headers['access-control-request-method'])) throw new CaptchaError('CORS_DENIED', '预检请求未获准', 403);
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' }); res.end(); return true;
      }
      if (assetNames.has(asset) && ['GET', 'HEAD'].includes(req.method)) {
        const data = await fs.readFile(new URL(`../dist/${asset}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': asset.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'Cross-Origin-Resource-Policy': 'cross-origin' });
        res.end(req.method === 'HEAD' ? undefined : data); return true;
      }
      if (route === '/siteverify') {
        // 验证端点不向浏览器开放；浏览器组件永远不需要后端密钥。
        if (origin || req.method !== 'POST') throw new CaptchaError('FORBIDDEN', '此接口仅用于服务端核验', 403);
        const provided = req.headers.authorization;
        const expected = `Bearer ${secret}`;
        if (!secret || typeof provided !== 'string' || Buffer.byteLength(provided) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) throw new CaptchaError('UNAUTHORIZED', '核验密钥不正确', 401);
        const body = await readJson(req);
        const success = await captcha.consumeToken({ token: body.token, ip: body.ip, action: body.action });
        sendJson(res, 200, { success }); return true;
      }
      const ip = getClientIp(req, trustedProxies);
      if (route === '/pow' && req.method === 'GET') {
        sendJson(res, 200, await captcha.createPow({ ip, action: url.searchParams.get('action') ?? 'default' })); return true;
      }
      const methods = { '/verify': 'verifyBehavior', '/challenge': 'solveChallenge', '/cancel': 'cancelChallenge' };
      if (methods[route] && req.method === 'POST') {
        const body = await readJson(req);
        const result = await captcha[methods[route]]({ ...body, ip });
        sendJson(res, 200, route === '/cancel' ? { cancelled: result } : result); return true;
      }
      throw new CaptchaError('NOT_FOUND', '验证码接口不存在或请求方法不正确', 404);
    } catch (err) {
      if (res.destroyed || res.writableEnded) return true;
      if (!(err instanceof CaptchaError)) onError?.(err);
      if (err.details?.retryAfterMs) res.setHeader('Retry-After', Math.ceil(err.details.retryAfterMs / 1000));
      sendJson(res, err instanceof CaptchaError ? err.status : 500, { error: err instanceof CaptchaError ? err.message : '验证服务暂时不可用', code: err instanceof CaptchaError ? err.code : 'INTERNAL_ERROR', ...(err instanceof CaptchaError ? err.details : {}) });
      return true;
    }
  };
}

/** 挂在 app.use(middleware)；或 app.use('/prefix', middleware) 并设置相对 basePath。 */
export function createExpressMiddleware(captcha, options) {
  const handler = createHttpHandler(captcha, options);
  return (req, res, next) => { void handler(req, res).then(handled => { if (!handled) next(); }, next); };
}
