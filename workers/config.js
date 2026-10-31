import { resolveCaptchaOptions } from '../src/core.js';
import { reputationOptionsFromEnv } from '../src/ip-reputation.js';
export function workerConfig(env) {
  const options = reputationOptionsFromEnv(env);
  const names = {
    powBits: 'CAPTCHA_POW_BITS', tolerance: 'CAPTCHA_TOLERANCE', minSolveMs: 'CAPTCHA_MIN_SOLVE_MS', minTokenAgeMs: 'CAPTCHA_MIN_TOKEN_AGE_MS',
    tokenTtlMs: 'CAPTCHA_TOKEN_TTL_MS', challengeTtlMs: 'CAPTCHA_CHALLENGE_TTL_MS', powTtlMs: 'CAPTCHA_POW_TTL_MS', maxChallengesPerIp: 'CAPTCHA_MAX_CHALLENGES_PER_IP',
    challengeTries: 'CAPTCHA_CHALLENGE_TRIES', rateLimit: 'CAPTCHA_RATE_LIMIT', rateWindowMs: 'CAPTCHA_RATE_WINDOW_MS',
  };
  for (const [key, name] of Object.entries(names)) if (env[name] !== undefined) options[key] = Number(env[name]);
  if (env.CAPTCHA_MODE !== undefined) options.mode = env.CAPTCHA_MODE;
  if (env.CAPTCHA_ENABLED !== undefined) {
    if (!['true', 'false'].includes(env.CAPTCHA_ENABLED)) throw new TypeError('CAPTCHA_ENABLED 必须为 true 或 false');
    options.enabled = env.CAPTCHA_ENABLED === 'true';
  }
  if (typeof env.CAPTCHA_SECRET !== 'string' || env.CAPTCHA_SECRET.length < 32 || env.CAPTCHA_SECRET.length > 1024) throw new TypeError('请设置至少 32 个字符的 CAPTCHA_SECRET secret');
  resolveCaptchaOptions(options);
  return { options, http: { secret: env.CAPTCHA_SECRET, basePath: env.CAPTCHA_BASE_PATH ?? '/captcha/v1', assetPath: env.CAPTCHA_ASSET_PATH ?? '/captcha/assets', allowedOrigins: (env.CAPTCHA_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean) } };
}
