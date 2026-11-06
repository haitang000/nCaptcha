import { test, expect } from '@playwright/test';
import { rotateByKeyboard } from './keyboard-helper.js';

const auth = { Authorization: 'Bearer test-private-service-secret-123456789' };
const binding = { ip: '127.0.0.1', action: 'demo', sessionId: 'browser-server-session' };
test.beforeEach(async ({ page }) => { await page.goto('/test'); });

test('后端意图贯穿真实浏览器请求，换题复用凭据且核验必须匹配原会话', async ({ page }) => {
  const operation = { ...binding, intentId: `browser-operation-${test.info().project.name}` };
  const response = await page.request.post('/captcha/v1/intent', { headers: auth, data: operation });
  expect(response.status()).toBe(200);
  const { intent } = await response.json();
  await page.evaluate(intent => {
    window.intentCalls = 0; window.publicBodies = [];
    window.widget = Captcha.render('#one', {
      action: 'demo', prewarm: false,
      intent: async signal => { signal.throwIfAborted(); intentCalls++; return intent; },
      fetch: (url, init) => { if (init.body) publicBodies.push(JSON.parse(init.body)); return fetch(url, init); }
    });
  }, intent);
  const challengeResponse = page.waitForResponse(response => response.url().endsWith('/captcha/v1/verify'));
  await page.evaluate(() => { window.pending = widget.verify().then(value => { window.result = value; }); });
  let { challenge } = await (await challengeResponse).json();
  await expect(page.locator('dialog[open]')).toBeVisible();
  const nextResponse = page.waitForResponse(response => response.url().endsWith('/captcha/v1/verify'));
  const state = await (await page.request.get('/state')).json();
  await rotateByKeyboard(page.locator('#one input[type=range]'), (450 - state[challenge.id].answer) % 360);
  ({ challenge } = await (await nextResponse).json());
  await expect(page.locator('#one input[type=range]')).toBeEnabled();
  const nextState = await (await page.request.get('/state')).json();
  await rotateByKeyboard(page.locator('#one input[type=range]'), (360 - nextState[challenge.id].answer) % 360);
  await expect(page.locator('#one .widget')).toHaveClass(/verified/);
  const token = await page.evaluate(() => widget.getToken());
  const wrong = await page.request.post('/captcha/v1/siteverify', { headers: auth, data: { ...operation, sessionId: 'another-session', token } });
  expect(await wrong.json()).toEqual({ success: false });
  const right = await page.request.post('/captcha/v1/siteverify', { headers: auth, data: { ...operation, token } });
  expect(await right.json()).toEqual({ success: true });
  expect(await page.evaluate(() => intentCalls)).toBe(1);
  const bodies = await page.evaluate(() => publicBodies);
  expect(bodies.every(body => body.intent === intent && body.sessionId === undefined && body.intentId === undefined)).toBe(true);
});

test('意图获取超时可重试，迟到结果不能覆盖新的上下文', async ({ page }) => {
  await page.evaluate(() => {
    window.intentCalls = 0; window.sentIntents = [];
    window.widget = Captcha.render('#one', {
      prewarm: false, requestTimeoutMs: 100,
      intent: signal => {
        intentCalls++;
        if (intentCalls === 1) { window.oldSignal = signal; return new Promise(resolve => { window.resolveOld = () => resolve('a'.repeat(64) + '.' + 'a'.repeat(64)); }); }
        return 'b'.repeat(64) + '.' + 'b'.repeat(64);
      },
      fetch: async (url, init) => {
        sentIntents.push(JSON.parse(init.body).intent);
        return new Response(JSON.stringify(url.includes('/pow') ? { prefix: '0'.repeat(32), bits: 0, expiresInMs: 120000 } : { token: 'c'.repeat(64), expiresInMs: 60000, usableAfterMs: 0 }));
      }
    });
  });
  expect(await page.evaluate(() => widget.verify().catch(error => error.code))).toBe('REQUEST_TIMEOUT');
  expect(await page.evaluate(() => oldSignal.aborted)).toBe(true);
  expect(await page.evaluate(() => widget.verify())).toBe('c'.repeat(64));
  await page.evaluate(async () => { resolveOld(); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(await page.evaluate(() => sentIntents)).toEqual(Array(2).fill('b'.repeat(64) + '.' + 'b'.repeat(64)));
});

test('reset 取消尚未完成的意图获取，并为下一轮重新获取', async ({ page }) => {
  await page.evaluate(() => {
    window.intentCalls = 0;
    window.widget = Captcha.render('#one', {
      prewarm: false,
      intent: signal => {
        intentCalls++;
        if (intentCalls === 1) { window.oldSignal = signal; return new Promise(() => {}); }
        return 'b'.repeat(64) + '.' + 'b'.repeat(64);
      },
      fetch: async url => new Response(JSON.stringify(url.includes('/pow') ? { prefix: '0'.repeat(32), bits: 0, expiresInMs: 120000 } : { token: 'c'.repeat(64), expiresInMs: 60000, usableAfterMs: 0 }))
    });
    window.pending = widget.verify().catch(error => { window.failure = error.name; });
  });
  await expect.poll(() => page.evaluate(() => intentCalls)).toBe(1);
  await page.evaluate(() => widget.reset());
  await expect.poll(() => page.evaluate(() => window.failure)).toBe('AbortError');
  expect(await page.evaluate(() => oldSignal.aborted)).toBe(true);
  expect(await page.evaluate(() => widget.verify())).toBe('c'.repeat(64));
});
