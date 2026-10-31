import { test, expect } from '@playwright/test';

for (const source of ['fastpass', 'compat-event']) test(`${source} 在图片弹窗中激活会结束本轮，直接返回机器人错误`, async ({ page }) => {
  await page.goto('/test');
  const issued = page.waitForResponse(response => response.url().endsWith('/captcha/v1/verify'));
  await page.evaluate(() => {
    window.errors = [];
    window.widget = Captcha.render('#one', { apiUrl: '/captcha/v1', assetBaseUrl: '/captcha/assets/', action: 'demo', prewarm: false,
      onError(error) { errors.push(error.code); } });
    window.pending = widget.verify().catch(error => { window.failure = error.code; });
  });
  await issued;
  await expect(page.locator('dialog[open]')).toBeVisible();
  await page.locator('#one .captcha-host').evaluate((host, source) => {
    if (source === 'fastpass') host.querySelector('[data-captcha-fastpass]').click();
    else host.dispatchEvent(new CustomEvent('captcha:compat'));
  }, source);
  await expect.poll(() => page.evaluate(() => window.failure)).toBe('BOT_DETECTED');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expect(await page.evaluate(() => errors)).toEqual(['BOT_DETECTED']);
  expect(await page.evaluate(() => widget.getToken())).toBe(null);
});

test('真令牌响应更新诱饵期限，快速通道仍报告同一轮而非新建 PoW', async ({ page }) => {
  await page.goto('/test');
  await page.evaluate(async () => {
    window.powRequests = 0; window.reports = [];
    const agent = expiresInMs => ({ ticket: '1'.repeat(32), token: 'a'.repeat(64), expiresInMs });
    window.widget = Captcha.render('#one', { assetBaseUrl: '/captcha/assets/', prewarm: false,
      fetch: async (url, options) => {
        if (url.includes('/pow?')) {
          powRequests++;
          return new Response(JSON.stringify({ prefix: '1'.repeat(32), bits: 0, expiresInMs: 60000, agent: agent(50) }));
        }
        if (url.endsWith('/verify')) return new Response(JSON.stringify({ token: 'b'.repeat(64), expiresInMs: 60000, usableAfterMs: 0, agent: agent(60000) }));
        reports.push(JSON.parse(options.body));
        return new Response(JSON.stringify({ code: 'BOT_DETECTED', bot: true, source: 'fastpass' }), { status: 403 });
      },
    });
    await widget.verify();
  });
  expect(await page.evaluate(() => widget.getToken())).toBe('b'.repeat(64));
  await page.waitForTimeout(100);
  await page.locator('#one [data-captcha-fastpass]').evaluate(button => button.click());
  await expect.poll(() => page.evaluate(() => reports.length)).toBe(1);
  expect(await page.evaluate(() => powRequests)).toBe(1);
  expect(await page.evaluate(() => reports[0])).toMatchObject({ ticket: '1'.repeat(32), source: 'fastpass' });
  expect(await page.evaluate(() => widget.getToken())).toBe(null);
});

test('超时任务迟到的机器人响应不能标记已经完成的新验证', async ({ page }) => {
  await page.goto('/test');
  await page.evaluate(() => {
    window.verifications = 0; window.errors = [];
    window.widget = Captcha.render('#one', { assetBaseUrl: '/captcha/assets/', prewarm: false, requestTimeoutMs: 100,
      onError(error) { errors.push(error.code); },
      fetch: async url => {
        if (url.includes('/pow?')) return new Response(JSON.stringify({ prefix: '1'.repeat(32), bits: 0, expiresInMs: 60000 }));
        if (++verifications === 1) return { ok: false, status: 403, json: () => new Promise(resolve => {
          window.finishLate = () => resolve({ code: 'BOT_DETECTED', bot: true, source: 'fallback-api' });
        }) };
        return new Response(JSON.stringify({ token: 'b'.repeat(64), expiresInMs: 60000, usableAfterMs: 0 }));
      },
    });
    window.pending = widget.verify().catch(error => { window.failure = error.code; });
  });
  await expect.poll(() => page.evaluate(() => window.failure)).toBe('REQUEST_TIMEOUT');
  expect(await page.evaluate(() => widget.verify())).toBe('b'.repeat(64));
  await page.evaluate(async () => { finishLate(); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(await page.evaluate(() => widget.getToken())).toBe('b'.repeat(64));
  await expect(page.locator('#one .captcha-host')).not.toHaveAttribute('data-captcha-bot');
  expect(await page.evaluate(() => errors)).toEqual(['REQUEST_TIMEOUT']);
});
