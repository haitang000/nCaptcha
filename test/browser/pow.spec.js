import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';

for (const fallback of [false, true]) test(`20 位 PoW ${fallback ? '主线程回退' : 'Worker'} 与原生 SHA-256 一致且被服务端接受`, async ({ page }) => {
  await page.route('**/captcha/v1/pow*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), bits: 20 } });
  });
  await page.goto('/test');
  const responsePromise = page.waitForResponse(r => r.url().endsWith('/captcha/v1/verify'));
  await page.evaluate(fallback => {
    window.widget = Captcha.render('#one', { apiUrl: '/captcha/v1', action: 'demo', prewarm: false, ...(fallback ? { workerUrl: '/missing-worker.js' } : {}) });
    window.pending = widget.verify();
    pending.catch(() => {});
  }, fallback);
  const response = await responsePromise;
  const { pow } = response.request().postDataJSON();
  expect(crypto.createHash('sha256').update(pow.prefix + pow.nonce).digest().readUInt32BE(0)).toBeLessThan(2 ** 12);
  expect(response.status()).toBe(200);
  await expect(page.locator('dialog[open]')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => widget.destroy());
});
