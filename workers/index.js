import { DurableObject } from 'cloudflare:workers';
import { Buffer } from 'node:buffer';
import { createCaptchaCore, validateContext } from '../src/core.js';
import { CaptchaError } from '../src/error.js';
import { createFetchHandler, jsonResponse, readRequestJson } from '../src/fetch.js';
import { createDurableStore } from './store.js';
import { workerConfig } from './config.js';
import puzzleData from '../.workers/puzzles.js';

const operations = ['createPow', 'verifyBehavior', 'solveChallenge', 'cancelChallenge', 'consumeToken'];
const landingAssets = new Set(['/', '/landing/styles.css', '/landing/app.js', '/landing/favicon.svg']);
let pictures;
function getPictures() {
  return pictures ??= puzzleData.map(({ rgba, ...image }) => ({ ...image, rgba: Buffer.from(rgba, 'base64') }));
}
export class CaptchaDurableObject extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.store = createDurableStore(ctx.storage);
    this.captcha = null;
  }
  async execute(operation, input) {
    try {
      if (!operations.includes(operation)) throw new CaptchaError('INVALID_OPERATION', '操作不存在');
      this.captcha ??= createCaptchaCore({ ...workerConfig(this.env).options, store: this.store, namespace: 'captcha' }, getPictures);
      const value = await this.captcha[operation](input);
      return { ok: true, value };
    } catch (error) {
      if (!(error instanceof CaptchaError)) console.error('[captcha object]', error);
      return { ok: false, error: { code: error instanceof CaptchaError ? error.code : 'INTERNAL_ERROR', message: error instanceof CaptchaError ? error.message : '验证服务暂时不可用', status: error instanceof CaptchaError ? error.status : 500, details: error instanceof CaptchaError ? error.details : {} } };
    } finally { await this.store.scheduleCleanup(); }
  }
  async alarm() { await this.store.cleanup(); }
}

export function createWorkerHandler() {
  return {
    async fetch(request, env) {
      try {
        const config = workerConfig(env);
        if (!env.CAPTCHA_STATE || !env.ASSETS) throw new TypeError('缺少 CAPTCHA_STATE 或 ASSETS 绑定');
        const proxy = Object.fromEntries(operations.map(operation => [operation, async input => {
          const { ip } = validateContext(input);
          const object = env.CAPTCHA_STATE.get(env.CAPTCHA_STATE.idFromName(ip));
          const result = await object.execute(operation, input);
          if (!result.ok) throw new CaptchaError(result.error.code, result.error.message, result.error.status, result.error.details);
          return result.value;
        }]));
        const handle = createFetchHandler(proxy, {
          ...config.http,
          getIp: req => validateContext({ ip: req.headers.get('CF-Connecting-IP') }).ip,
          serveAsset: (name, req) => { const url = new URL(req.url); url.pathname = '/' + name; url.search = ''; return env.ASSETS.fetch(new Request(url, req)); },
        });
        const url = new URL(request.url);
        if (url.pathname === '/health' && request.method === 'GET') return jsonResponse(200, { ok: true });
        if (landingAssets.has(url.pathname) && ['GET', 'HEAD'].includes(request.method)) return env.ASSETS.fetch(request);
        if (url.pathname === '/demo/verify') {
          if (request.method !== 'POST') return jsonResponse(405, { error: '请使用 POST', code: 'METHOD_NOT_ALLOWED' });
          if (request.headers.get('origin') !== url.origin) return jsonResponse(403, { error: '该来源未获准访问', code: 'ORIGIN_DENIED' });
          try {
            const { token } = await readRequestJson(request);
            const success = await proxy.consumeToken({ token, ip: request.headers.get('CF-Connecting-IP'), action: 'landing-demo' });
            return jsonResponse(success ? 200 : 400, success ? { success: true } : { success: false, error: '令牌无效或已过期，请重新验证' });
          } catch (error) {
            if (!(error instanceof CaptchaError)) throw error;
            return jsonResponse(error.status, { error: error.message, code: error.code });
          }
        }
        return await handle(request) ?? jsonResponse(404, { error: '未找到', code: 'NOT_FOUND' });
      } catch (error) {
        console.error('[captcha worker]', error);
        return jsonResponse(503, { error: '验证码服务配置不正确或暂时不可用', code: 'SERVICE_UNAVAILABLE' });
      }
    },
  };
}
export default createWorkerHandler();
