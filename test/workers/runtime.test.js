import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { fileURLToPath } from 'node:url';
import { nonceFor, challengeTrajectory, keyboardForAngle } from '../helpers.js';
import { behaviorScenarios } from '../fixtures/behavior-scenarios.js';
import { chromium } from '@playwright/test';
import { rotateByKeyboard } from '../browser/keyboard-helper.js';

const secret = 'workerd-private-secret-at-least-32-characters';
let mf;
before(async () => {
  await import('../../scripts/build-workers.js');
  await build({ entryPoints: ['workers/index.js'], outfile: '.workers/test-bundle.js', bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', external: ['node:*', 'cloudflare:workers'] });
  mf = new Miniflare({ ...convertV4MiniflareOptions({ cf: false, port: 18879, workers: [{ name: 'captcha', modules: true, scriptPath: '.workers/test-bundle.js', compatibilityDate: '2026-10-01',
    durableObjects: { CAPTCHA_STATE: { className: 'CaptchaDurableObject', useSQLite: true } },
    assets: { directory: fileURLToPath(new URL('../../dist/', import.meta.url)), binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true } },
    bindings: { CAPTCHA_SECRET: secret, CAPTCHA_ALLOWED_ORIGINS: 'https://business.example,http://127.0.0.1:18879', CAPTCHA_POW_BITS: '3', CAPTCHA_MIN_SOLVE_MS: '0', CAPTCHA_MIN_TOKEN_AGE_MS: '0' },
  }] }), unsafeInspectDurableObjects: true });
  await mf.ready;
});
after(async () => { await mf?.dispose(); });
const get = (path, ip = '192.0.2.1', headers = {}) => mf.dispatchFetch('https://captcha.example' + path, { headers: { 'CF-Connecting-IP': ip, ...headers } });
const post = (path, body, ip = '192.0.2.1', headers = {}) => mf.dispatchFetch('https://captcha.example/captcha/v1' + path, { method: 'POST', headers: { 'CF-Connecting-IP': ip, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
async function issue(ip, action = 'login') {
  const powResponse = await get('/captcha/v1/pow?action=' + action, ip);
  assert.equal(powResponse.status, 200, await powResponse.clone().text());
  const pow = await powResponse.json();
  const response = await post('/verify', { action, pow: { prefix: pow.prefix, nonce: nonceFor(pow) } }, ip);
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()).challenge;
}
async function dbFor(ip) { return mf.unsafeGetDurableObjectStorage('captcha', 'CaptchaDurableObject', { name: ip }); }
async function solve(ip, action = 'login') {
  const challenge = await issue(ip, action);
  const db = await dbFor(ip);
  const row = (await db.exec('SELECT value FROM captcha_state WHERE key = ?', 'captcha:challenge:' + challenge.id))[0];
  const response = await post('/challenge', { action, id: challenge.id, angle: -JSON.parse(row.value).answer, trajectory: challengeTrajectory }, ip);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
test('真实 workerd 严格挑战、图片 PNG、原子并发消费和重放', async () => {
  const ip = '192.0.2.1';
  const challenge = await issue(ip);
  const png = Buffer.from(challenge.image.split(',')[1], 'base64');
  assert.equal(png.subarray(1, 4).toString(), 'PNG'); assert.equal(challenge.answer, undefined);
  await post('/cancel', { action: 'login', id: challenge.id }, ip);
  const result = await solve(ip);
  const responses = await Promise.all(Array.from({ length: 12 }, () => post('/siteverify', { token: result.token, ip, action: 'login' }, '203.0.113.99', { Authorization: `Bearer ${secret}` })));
  const verdicts = await Promise.all(responses.map(r => r.json()));
  assert.equal(verdicts.filter(r => r.success).length, 1);
});

test('Workers 使用同一多维评测，拒绝抖动采样恒速与混合键盘掩盖轨迹', async () => {
  for (const [i, id] of ['jitter-speed', 'mixed-bypass'].entries()) {
    const ip = `192.0.2.${22 + i}`, challenge = await issue(ip);
    const row = (await (await dbFor(ip)).exec('SELECT value FROM captcha_state WHERE key = ?', 'captcha:challenge:' + challenge.id))[0];
    const angle = -JSON.parse(row.value).answer;
    const scenario = behaviorScenarios.find(s => s.id === id);
    await new Promise(resolve => setTimeout(resolve, 500));
    const response = await post('/challenge', { ...scenario.input, id: challenge.id, action: 'login', angle, keyboard: keyboardForAngle(angle) }, ip);
    assert.equal(response.status, 400);
    const error = await response.json();
    assert.equal(error.code, 'BEHAVIOR_REJECTED'); assert.equal(error.triesRemaining, 2);
    assert.equal(error.dimensions, undefined);
    const retry = await post('/challenge', { id: challenge.id, action: 'login', angle, trajectory: challengeTrajectory }, ip);
    assert.equal(retry.status, 200); assert.ok((await retry.json()).token);
  }
});
test('真实 Durable Object 驱逐/重建后仍保留令牌；过期状态不通过', async () => {
  const ip = '192.0.2.2';
  const result = await solve(ip);
  await mf.unsafeEvictDurableObject('captcha', 'CaptchaDurableObject', { name: ip });
  const response = await post('/siteverify', { token: result.token, ip, action: 'login' }, '203.0.113.99', { Authorization: `Bearer ${secret}` });
  assert.equal((await response.json()).success, true);
  const expired = await solve(ip);
  await (await dbFor(ip)).exec('UPDATE captcha_state SET expires_at = 0 WHERE key = ?', 'captcha:token:' + expired.token);
  assert.equal((await (await post('/siteverify', { token: expired.token, ip, action: 'login' }, ip, { Authorization: `Bearer ${secret}` })).json()).success, false);
});
test('按 IP 隔离挑战限额、独立取消、用途和 IP 绑定', async () => {
  const ip = '192.0.2.3';
  const a = await issue(ip), b = await issue(ip), c = await issue(ip);
  const pow = await (await get('/captcha/v1/pow?action=login', ip)).json();
  const limited = await post('/verify', { action: 'login', pow: { prefix: pow.prefix, nonce: nonceFor(pow) } }, ip);
  assert.equal(limited.status, 429); assert.equal((await limited.json()).code, 'CHALLENGE_LIMIT');
  assert.equal((await (await post('/cancel', { action: 'login', id: a.id }, ip)).json()).cancelled, true);
  const db = await dbFor(ip);
  assert.equal((await db.exec('SELECT key FROM captcha_state WHERE key IN (?, ?)', 'captcha:challenge:' + b.id, 'captcha:challenge:' + c.id)).length, 2);
  assert.ok((await issue('192.0.2.4')).id);
  await post('/cancel', { action: 'login', id: b.id }, ip); await post('/cancel', { action: 'login', id: c.id }, ip);
  const result = await solve(ip);
  const auth = { Authorization: `Bearer ${secret}` };
  assert.equal((await (await post('/siteverify', { token: result.token, ip: '192.0.2.5', action: 'login' }, ip, auth)).json()).success, false);
  assert.equal((await (await post('/siteverify', { token: result.token, ip, action: 'register' }, ip, auth)).json()).success, false);
});
test('Worker 来源、secret、资源白名单和 IP 伪造防护', async () => {
  const health = await get('/health'); assert.equal(health.status, 200, await health.clone().text());
  assert.equal((await get('/captcha/v1/pow', '192.0.2.6', { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('/siteverify', { ip: '192.0.2.6', token: 'x' })).status, 401);
  assert.equal((await post('/siteverify', { ip: '192.0.2.6', token: 'x' }, '192.0.2.6', { Origin: 'https://business.example', Authorization: `Bearer ${secret}` })).status, 403);
  for (const file of ['captcha.js', 'captcha.esm.js', 'captcha.css', 'pow-worker.js']) {
    const response = await get('/captcha/assets/' + file);
    assert.equal(response.status, 200); assert.ok(!(await response.text()).includes(secret));
  }
  assert.equal((await get('/captcha/assets/puzzles.js')).status, 404);
  assert.equal((await get('/.workers/puzzles.js')).status, 404);
  const ip = '192.0.2.6', pow = await (await get('/captcha/v1/pow?action=login', ip)).json();
  const wrong = await post('/verify', { ip, action: 'login', pow: { prefix: pow.prefix, nonce: nonceFor(pow) } }, '192.0.2.7', { 'X-Forwarded-For': ip });
  assert.equal(wrong.status, 400); assert.equal((await wrong.json()).code, 'POW_INVALID');
});
test('workerd 持久存储上的每 IP 限流原子执行', async () => {
  const responses = await Promise.all(Array.from({ length: 61 }, () => get('/captcha/v1/pow', '192.0.2.8')));
  assert.equal(responses.filter(response => response.status === 200).length, 60);
  assert.equal(responses.filter(response => response.status === 429).length, 1);
  assert.equal((await get('/captcha/v1/pow', '192.0.2.9')).status, 200);
});

test('Workers 按规范化 IPv6 定位同一个 Durable Object，等价地址不能分摊限流', async () => {
  const variants = ['2001:db8::1', '2001:0DB8:0000:0000:0000:0000:0000:0001'];
  const responses = await Promise.all(Array.from({ length: 61 }, (_, i) => get('/captcha/v1/pow', variants[i % 2])));
  assert.equal(responses.filter(response => response.status === 200).length, 60);
  assert.equal(responses.filter(response => response.status === 429).length, 1);
});

test('Workers 不再提供 Demo 页面与公开核验入口，业务令牌仍通过密钥接口消费', async () => {
  for (const path of ['/', '/landing/styles.css', '/landing/app.js', '/landing/favicon.svg', '/examples', '/module', '/test/form']) {
    const response = await get(path); assert.equal(response.status, 404, path);
  }
  const ip = '192.0.2.20';
  const business = await solve(ip, 'register');
  for (const method of ['GET', 'HEAD', 'POST']) {
    const response = await mf.dispatchFetch('https://captcha.example/demo/verify', {
      method, headers: { 'CF-Connecting-IP': ip, 'Content-Type': 'application/json', Origin: 'https://captcha.example' },
      ...(method === 'POST' ? { body: JSON.stringify({ token: business.token }) } : {}),
    });
    assert.equal(response.status, 404, method);
  }
  const businessCheck = await post('/siteverify', { token: business.token, ip, action: 'register' }, ip, { Authorization: `Bearer ${secret}` });
  assert.equal((await businessCheck.json()).success, true);
});
test('浏览器从真实 Workers 资源加载 UI，完成图片验证并由业务后端消费', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:18879/health');
    await page.evaluate(async () => {
      document.body.innerHTML = '<main id="captcha"></main>';
      const { render } = await import('/captcha/assets/captcha.esm.js');
      window.widget = render('#captcha', { action: 'browser', prewarm: false });
    });
    const verified = page.waitForResponse(response => response.url().endsWith('/captcha/v1/verify'));
    await page.evaluate(() => { window.promise = widget.verify(); window.promise.then(token => { window.token = token; }, error => { window.failure = error.message; }); });
    const response = await verified;
    assert.equal(response.status(), 200, await response.text());
    const { challenge } = await response.json();
    const row = (await (await dbFor('127.0.0.1')).exec('SELECT value FROM captcha_state WHERE key = ?', 'captcha:challenge:' + challenge.id))[0];
    const angle = (360 - JSON.parse(row.value).answer) % 360;
    await rotateByKeyboard(page.locator('input[type=range]'), angle);
    await page.waitForFunction(() => !!window.token);
    const token = await page.evaluate(() => widget.getToken());
    assert.equal((await (await post('/siteverify', { token, ip: '127.0.0.1', action: 'browser' }, '203.0.113.99', { Authorization: `Bearer ${secret}` })).json()).success, true);
    await page.evaluate(() => widget.destroy());
    assert.equal(await page.locator('.widget').count(), 0); assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
