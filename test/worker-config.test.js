import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workerConfig } from '../workers/config.js';
const secret = 'worker-config-secret-at-least-32-characters';
test('Workers 绑定配置采用核心相同的验证和默认策略', () => {
  const config = workerConfig({ CAPTCHA_SECRET: secret, CAPTCHA_POW_BITS: '12', CAPTCHA_MODE: 'normal', CAPTCHA_ALLOWED_ORIGINS: 'https://app.example, https://second.example' });
  assert.equal(config.options.powBits, 12); assert.equal(config.options.mode, 'normal');
  assert.deepEqual(config.http.allowedOrigins, ['https://app.example', 'https://second.example']);
  for (const extra of [{ CAPTCHA_POW_BITS: 'NaN' }, { CAPTCHA_MODE: 'invalid' }, { CAPTCHA_ENABLED: 'yes' }, { CAPTCHA_MIN_TOKEN_AGE_MS: '300000' }, { CAPTCHA_SECRET: 'short' }]) assert.throws(() => workerConfig({ CAPTCHA_SECRET: secret, ...extra }), TypeError);
});
