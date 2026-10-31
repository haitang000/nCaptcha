import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { CaptchaError } from './error.js';

export const clientAssets = new Set(['captcha.js', 'captcha.esm.js', 'captcha.css', 'pow-worker.js']);
export function jsonResponse(status, data, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}
export async function readRequestJson(request, maxBytes = 65536) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new CaptchaError('CONTENT_TYPE', '请发送 application/json', 415);
  if (request.headers.has('content-encoding') && request.headers.get('content-encoding') !== 'identity') throw new CaptchaError('CONTENT_ENCODING', '不支持压缩请求体', 415);
  if (Number(request.headers.get('content-length')) > maxBytes) throw new CaptchaError('BODY_TOO_LARGE', '请求体过大', 413);
  const reader = request.body?.getReader();
  let size = 0;
  const chunks = [];
  if (reader) try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new CaptchaError('BODY_TOO_LARGE', '请求体过大', 413); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new CaptchaError('INVALID_JSON', '请求 JSON 格式不正确'); }
}

/** Web Request/Response 适配器。IP 必须由平台可信信息解析，不能采用用户请求体。 */
export function createFetchHandler(captcha, { basePath = '/captcha/v1', assetPath = '/captcha/assets', allowedOrigins = [], secret, getIp, serveAsset, onError = console.error } = {}) {
  if (!/^\/(?:[\w-]+\/?)*$/.test(basePath) || basePath.endsWith('/') || !/^\/[\w/-]+$/.test(assetPath) || assetPath.endsWith('/')) throw new TypeError('basePath/assetPath 配置不正确');
  if (secret !== undefined && (typeof secret !== 'string' || secret.length < 32 || secret.length > 1024)) throw new TypeError('secret 至少需要 32 个字符');
  if (!Array.isArray(allowedOrigins) || allowedOrigins.some(origin => { try { return new URL(origin).origin !== origin || !/^https?:/.test(origin); } catch { return true; } })) throw new TypeError('allowedOrigins 必须为精确 HTTP(S) 来源');
  if (typeof getIp !== 'function') throw new TypeError('必须提供可信的 getIp(request)');
  return async request => {
    const headers = { Vary: 'Origin', 'X-Content-Type-Options': 'nosniff' };
    try {
      const url = new URL(request.url);
      const route = url.pathname.startsWith(basePath + '/') ? url.pathname.slice(basePath.length) : null;
      const asset = url.pathname.startsWith(assetPath + '/') ? url.pathname.slice(assetPath.length + 1) : '';
      if (!route && !clientAssets.has(asset)) return null;
      const origin = request.headers.get('origin');
      if (origin && !allowedOrigins.includes(origin)) throw new CaptchaError('ORIGIN_DENIED', '该来源未获准访问', 403);
      if (origin) headers['Access-Control-Allow-Origin'] = origin;
      if (request.method === 'OPTIONS') {
        const requestedHeaders = (request.headers.get('access-control-request-headers') ?? '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
        if (!origin || ['/siteverify', '/reputation'].includes(route) || !['GET', 'POST'].includes(request.headers.get('access-control-request-method')) || requestedHeaders.some(value => value !== 'content-type')) throw new CaptchaError('CORS_DENIED', '预检请求未获准', 403);
        return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' } });
      }
      if (clientAssets.has(asset) && ['GET', 'HEAD'].includes(request.method) && serveAsset) {
        const original = await serveAsset(asset, request);
        const responseHeaders = new Headers(original.headers);
        for (const [name, value] of Object.entries(headers)) responseHeaders.set(name, value);
        responseHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');
        responseHeaders.set('Cache-Control', 'public, max-age=300');
        return new Response(request.method === 'HEAD' ? null : original.body, { status: original.status, headers: responseHeaders });
      }
      if (route === '/siteverify' || route === '/reputation') {
        if (origin || request.method !== 'POST') throw new CaptchaError('FORBIDDEN', '此接口仅用于服务端核验', 403);
        const actual = request.headers.get('authorization'), expected = `Bearer ${secret}`;
        if (!secret || !actual || Buffer.byteLength(actual) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) throw new CaptchaError('UNAUTHORIZED', '核验密钥不正确', 401);
        const body = await readRequestJson(request);
        if (route === '/reputation') return jsonResponse(200, await captcha.checkIpReputation({ ip: body.ip }), headers);
        return jsonResponse(200, { success: await captcha.consumeToken({ token: body.token, ip: body.ip, action: body.action }) }, headers);
      }
      const ip = getIp(request);
      if (route === '/pow' && request.method === 'GET') return jsonResponse(200, await captcha.createPow({ ip, action: url.searchParams.get('action') ?? 'default' }), headers);
      const methods = { '/verify': 'verifyBehavior', '/challenge': 'solveChallenge', '/cancel': 'cancelChallenge', '/compat': 'reportAgent' };
      if (methods[route] && request.method === 'POST') {
        const body = await readRequestJson(request);
        const value = await captcha[methods[route]]({ ...body, ip });
        return jsonResponse(200, route === '/cancel' ? { cancelled: value } : value, headers);
      }
      throw new CaptchaError('NOT_FOUND', '验证码接口不存在或请求方法不正确', 404);
    } catch (error) {
      if (!(error instanceof CaptchaError)) onError?.(error);
      if (error.details?.retryAfterMs) headers['Retry-After'] = String(Math.ceil(error.details.retryAfterMs / 1000));
      return jsonResponse(error instanceof CaptchaError ? error.status : 500, { error: error instanceof CaptchaError ? error.message : '验证服务暂时不可用', code: error instanceof CaptchaError ? error.code : 'INTERNAL_ERROR', ...(error instanceof CaptchaError ? error.details : {}) }, headers);
    }
  };
}
