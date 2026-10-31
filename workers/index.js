import { DurableObject } from 'cloudflare:workers';
import { Buffer } from 'node:buffer';
import { createCaptchaCore, validateContext } from '../src/core.js';
import { CaptchaError } from '../src/error.js';
import { createFetchHandler, jsonResponse } from '../src/fetch.js';
import { createDurableStore } from './store.js';
import { workerConfig } from './config.js';
import puzzleData from '../.workers/puzzles.js';

const operations = ['createPow', 'verifyBehavior', 'solveChallenge', 'cancelChallenge', 'consumeToken'];
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
        return await handle(request) ?? jsonResponse(404, { error: '未找到', code: 'NOT_FOUND' });
      } catch (error) {
        console.error('[captcha worker]', error);
        return jsonResponse(503, { error: '验证码服务配置不正确或暂时不可用', code: 'SERVICE_UNAVAILABLE' });
      }
    },
  };
}
export default createWorkerHandler();
