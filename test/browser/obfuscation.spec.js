import { test, expect } from '@playwright/test';
import { rotateByKeyboard } from './keyboard-helper.js';

for (const format of ['script', 'esm']) for (const fallback of [false, true]) {
  test(`混淆产物 ${format} 在禁止 eval 的 CSP 下完成验证（${fallback ? '主线程回退' : 'Worker'}）`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/test', route => route.fulfill({
      contentType: 'text/html',
      headers: { 'Content-Security-Policy': "script-src 'self'; worker-src 'self'; object-src 'none'" },
      body: '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><div id="one"></div></html>',
    }));
    await page.addInitScript(() => {
      window.cspViolations = [];
      document.addEventListener('securitypolicyviolation', event => cspViolations.push(event.violatedDirective));
      window.powWorkerMessages = 0;
      window.powWorkerErrors = 0;
      const OriginalWorker = window.Worker;
      window.Worker = class extends OriginalWorker {
        constructor(...args) {
          super(...args);
          this.addEventListener('error', () => { window.powWorkerErrors++; });
        }
        postMessage(...args) { window.powWorkerMessages++; return super.postMessage(...args); }
      };
    });
    await page.goto('/test');
    if (format === 'script') await page.addScriptTag({ url: '/captcha/assets/captcha.js' });
    const issued = page.waitForResponse(response => response.url().endsWith('/captcha/v1/verify'));
    await page.evaluate(async ({ format, fallback }) => {
      const api = format === 'esm' ? await import('/captcha/assets/captcha.esm.js') : window.Captcha;
      const error = new api.CaptchaClientError('test', 'TEST_ERROR');
      window.clientError = { name: error.name, code: error.code, isError: error instanceof Error };
      window.widget = api.render('#one', {
        apiUrl: '/captcha/v1', action: 'demo', prewarm: false,
        ...(fallback ? { workerUrl: '/missing-worker.js' } : {}),
        onSuccess(token) { window.verifiedToken = token; },
      });
      window.pending = widget.verify().catch(error => { window.failure = error.message; });
    }, { format, fallback });
    const { challenge } = await (await issued).json();
    await expect(page.locator('dialog[open]')).toBeVisible();
    expect(await page.evaluate(() => clientError)).toEqual({ name: 'CaptchaClientError', code: 'TEST_ERROR', isError: true });
    expect(await page.evaluate(() => powWorkerMessages)).toBe(1);
    expect(await page.evaluate(() => powWorkerErrors)).toBe(fallback ? 1 : 0);
    const state = await (await page.request.get('/state')).json();
    await page.waitForTimeout(120);
    await rotateByKeyboard(page.locator('input[type=range]'), (360 - state[challenge.id].answer) % 360);
    await expect(page.locator('.widget')).toHaveClass(/verified/);
    const token = await page.evaluate(() => widget.getToken());
    expect(await page.evaluate(() => verifiedToken)).toBe(token);
    expect((await page.request.post('/submit', { data: { token } })).status()).toBe(200);
    expect((await page.request.post('/submit', { data: { token } })).status()).toBe(400);
    expect(await page.evaluate(() => cspViolations)).toEqual([]);
    expect(errors).toEqual([]);
    await page.evaluate(() => widget.destroy());
  });
}
