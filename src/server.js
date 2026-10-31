import http from 'node:http';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createCaptcha } from './index.js';
import { createHttpHandler, sendJson } from './http.js';
import { CaptchaError } from './error.js';

export function configFromEnv(env) {
  const numeric = {
    powBits: 'CAPTCHA_POW_BITS', tolerance: 'CAPTCHA_TOLERANCE', minSolveMs: 'CAPTCHA_MIN_SOLVE_MS', minTokenAgeMs: 'CAPTCHA_MIN_TOKEN_AGE_MS',
    tokenTtlMs: 'CAPTCHA_TOKEN_TTL_MS', challengeTtlMs: 'CAPTCHA_CHALLENGE_TTL_MS', powTtlMs: 'CAPTCHA_POW_TTL_MS', maxChallengesPerIp: 'CAPTCHA_MAX_CHALLENGES_PER_IP',
    challengeTries: 'CAPTCHA_CHALLENGE_TRIES', rateLimit: 'CAPTCHA_RATE_LIMIT', rateWindowMs: 'CAPTCHA_RATE_WINDOW_MS',
  };
  const options = {};
  for (const [key, name] of Object.entries(numeric)) if (env[name] !== undefined) options[key] = Number(env[name]);
  if (env.CAPTCHA_ENABLED !== undefined) {
    if (!['true', 'false'].includes(env.CAPTCHA_ENABLED)) throw new TypeError('CAPTCHA_ENABLED 必须为 true 或 false');
    options.enabled = env.CAPTCHA_ENABLED === 'true';
  }
  if (env.CAPTCHA_MODE) options.mode = env.CAPTCHA_MODE;
  if (env.CAPTCHA_IMAGES_DIR) options.imagesDir = env.CAPTCHA_IMAGES_DIR;
  const port = Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError('PORT 配置不正确');
  const list = name => (env[name] ?? '').split(',').map(value => value.trim()).filter(Boolean);
  if (!env.CAPTCHA_SECRET) throw new TypeError('请设置至少 32 个字符的 CAPTCHA_SECRET，仅由业务后端持有');
  return { options, host: env.HOST ?? '127.0.0.1', port, http: { basePath: env.CAPTCHA_BASE_PATH ?? '/captcha/v1', assetPath: env.CAPTCHA_ASSET_PATH ?? '/captcha/assets', secret: env.CAPTCHA_SECRET, allowedOrigins: list('CAPTCHA_ALLOWED_ORIGINS'), trustedProxies: list('CAPTCHA_TRUSTED_PROXIES') } };
}
export function startService(config) {
  const captcha = createCaptcha(config.options);
  let handler;
  try { handler = createHttpHandler(captcha, config.http); } catch (err) { void captcha.close(); throw err; }
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/health' && req.method === 'GET') { sendJson(res, 200, { ok: true }); return; }
      if (await handler(req, res)) return;
      sendJson(res, 404, { error: '未找到', code: 'NOT_FOUND' });
    } catch (err) {
      if (res.destroyed || res.writableEnded) return;
      if (!(err instanceof CaptchaError)) console.error(err);
      sendJson(res, err instanceof CaptchaError ? err.status : 500, {
        error: err instanceof CaptchaError ? err.message : '验证服务暂时不可用',
        code: err instanceof CaptchaError ? err.code : 'INTERNAL_ERROR',
      });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on('close', () => { void captcha.close(); });
  server.listen(config.port, config.host, () => console.log(`CAPTCHA 服务已启动：http://${config.host}:${config.port}`));
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (existsSync('.env')) process.loadEnvFile('.env');
    const server = startService(configFromEnv(process.env));
    const stop = () => { server.close(); server.closeIdleConnections(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    server.on('error', err => { console.error(err.message); process.exitCode = 1; });
  } catch (err) { console.error(err.message); process.exitCode = 1; }
}
