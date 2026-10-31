import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.__requestErrors = [];
  page.on('pageerror', error => page.__requestErrors.push(error.message));
});
test.afterEach(async ({ page }) => { expect(page.__requestErrors).toEqual([]); });

for (const endpoint of ['pow', 'verify']) for (const stalled of ['fetch', 'body']) {
  test(`${endpoint} 的 ${stalled} 挂起可超时重试，迟到响应不能覆盖新令牌`, async ({ page }) => {
    await page.goto('/test');
    await page.evaluate(({ endpoint, stalled }) => {
      window.successes = []; window.errors = []; window.calls = { pow: 0, verify: 0 };
      const proof = { prefix: '0'.repeat(32), bits: 0, expiresInMs: 120000 };
      const result = token => ({ token: token.repeat(64), expiresInMs: 60000, usableAfterMs: 0 });
      window.widget = Captcha.render('#one', {
        requestTimeoutMs: 100, prewarm: endpoint === 'pow',
        onSuccess(token) { successes.push(token); }, onError(error) { errors.push(error.code); },
        fetch: async (url, { signal }) => {
          const name = new URL(url).pathname.split('/').at(-1); calls[name]++;
          if (name === endpoint && calls[name] === 1) {
            window.stalledSignal = signal;
            const data = name === 'pow' ? proof : result('a');
            // 故意忽略 abort，模拟自定义传输或响应体实现不响应取消。
            if (stalled === 'fetch') return new Promise(resolve => { window.resolveLate = () => resolve(new Response(JSON.stringify(data))); });
            return { ok: true, json: () => new Promise(resolve => { window.resolveLate = () => resolve(data); }) };
          }
          return new Response(JSON.stringify(name === 'pow' ? proof : result('b')));
        },
      });
      window.pending = widget.verify().catch(error => { window.failure = { name: error.name, code: error.code }; });
    }, { endpoint, stalled });
    await expect.poll(() => page.evaluate(() => window.failure)).toEqual({ name: 'CaptchaClientError', code: 'REQUEST_TIMEOUT' });
    await expect(page.locator('.widget')).toHaveClass(/error/);
    expect(await page.evaluate(() => stalledSignal.aborted)).toBe(true);
    expect(await page.evaluate(() => errors)).toEqual(['REQUEST_TIMEOUT']);
    expect(await page.evaluate(() => successes)).toEqual([]);
    expect(await page.evaluate(() => widget.verify())).toBe('b'.repeat(64));
    await page.evaluate(async () => { resolveLate(); await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(await page.evaluate(() => widget.getToken())).toBe('b'.repeat(64));
    expect(await page.evaluate(() => successes)).toEqual(['b'.repeat(64)]);
    expect(await page.evaluate(() => calls)).toEqual({ pow: 2, verify: endpoint === 'pow' ? 1 : 2 });
    await page.evaluate(() => widget.destroy());
  });
}

for (const operation of ['reset', 'destroy']) test(`请求挂起时 ${operation} 保持 AbortError，迟到令牌不触发回调`, async ({ page }) => {
  await page.goto('/test');
  await page.evaluate(() => {
    window.successes = 0; window.errors = 0;
    window.widget = Captcha.render('#one', {
      prewarm: false, requestTimeoutMs: 10000,
      onSuccess() { successes++; }, onError() { errors++; },
      fetch: async (url, { signal }) => {
        if (url.includes('/pow?')) return new Response(JSON.stringify({ prefix: '0'.repeat(32), bits: 0, expiresInMs: 120000 }));
        window.stalledSignal = signal;
        return new Promise(resolve => { window.resolveLate = () => resolve(new Response(JSON.stringify({ token: 'a'.repeat(64), expiresInMs: 60000, usableAfterMs: 0 }))); });
      },
    });
    widget.verify().catch(error => { window.failure = error.name; });
  });
  await expect.poll(() => page.evaluate(() => !!window.resolveLate)).toBe(true);
  await page.evaluate(operation => widget[operation](), operation);
  await expect.poll(() => page.evaluate(() => window.failure)).toBe('AbortError');
  await page.evaluate(async () => { resolveLate(); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(await page.evaluate(() => [stalledSignal.aborted, successes, errors, widget.getToken()])).toEqual([true, 0, 0, null]);
});

test('请求超时配置在挂载前拒绝非法数值', async ({ page }) => {
  await page.goto('/test');
  expect(await page.evaluate(() => [0, -1, 1.5, NaN, Infinity, 2147483648].map(requestTimeoutMs => {
    try { Captcha.render('#one', { requestTimeoutMs }); return false; } catch (error) { return error instanceof TypeError; }
  }))).toEqual(Array(6).fill(true));
  await expect(page.locator('.widget')).toHaveCount(0);
});

test('图片答案请求超时可重试，释放挑战仍独立等待 3 秒，迟到答案不触发成功', async ({ page }) => {
  await page.goto('/test');
  await page.evaluate(() => {
    let verifications = 0;
    window.successes = []; window.errors = [];
    window.widget = Captcha.render('#one', {
      prewarm: false, requestTimeoutMs: 100,
      onSuccess(token) { successes.push(token); }, onError(error) { errors.push(error.code); },
      fetch: async (url, { signal }) => {
        const name = new URL(url).pathname.split('/').at(-1);
        if (name === 'pow') return new Response(JSON.stringify({ prefix: '0'.repeat(32), bits: 0, expiresInMs: 120000 }));
        if (name === 'verify') {
          if (++verifications === 1) return new Response(JSON.stringify({ challenge: { id: '0'.repeat(32), image: document.createElement('canvas').toDataURL(), expiresInMs: 60000 } }));
          return new Response(JSON.stringify({ token: 'b'.repeat(64), expiresInMs: 60000, usableAfterMs: 0 }));
        }
        if (name === 'cancel') { window.cancelSignal = signal; return new Promise(() => {}); }
        window.answerSignal = signal;
        return { ok: true, json: () => new Promise(resolve => { window.resolveLate = () => resolve({ token: 'a'.repeat(64), expiresInMs: 60000, usableAfterMs: 0 }); }) };
      },
    });
    widget.verify().catch(error => { window.failure = error.code; });
  });
  await expect(page.locator('dialog[open]')).toBeVisible();
  await page.locator('.range').press('Enter');
  await expect.poll(() => page.evaluate(() => window.failure)).toBe('REQUEST_TIMEOUT');
  expect(await page.evaluate(() => [answerSignal.aborted, cancelSignal.aborted, successes.length])).toEqual([true, false, 0]);
  expect(await page.evaluate(() => widget.verify())).toBe('b'.repeat(64));
  await page.evaluate(async () => { resolveLate(); await new Promise(resolve => setTimeout(resolve, 200)); });
  expect(await page.evaluate(() => cancelSignal.aborted)).toBe(false);
  expect(await page.evaluate(() => [widget.getToken(), successes, errors])).toEqual(['b'.repeat(64), ['b'.repeat(64)], ['REQUEST_TIMEOUT']]);
  await expect.poll(() => page.evaluate(() => cancelSignal.aborted), { timeout: 4000 }).toBe(true);
  await page.evaluate(() => widget.destroy());
});
