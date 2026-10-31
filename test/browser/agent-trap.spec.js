import { test, expect } from '@playwright/test';
import { rotateByKeyboard } from './keyboard-helper.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/test');
  await page.evaluate(() => {
    window.successes = []; window.errors = [];
    window.widget = Captcha.render('#one', {
      apiUrl: '/captcha/v1', assetBaseUrl: '/captcha/assets/', action: 'demo', prewarm: false,
      onSuccess(token) { successes.push(token); }, onError(error) { errors.push(error.code); },
    });
  });
});

async function declareAgent(page, events = true) {
  await page.locator('#one input[data-captcha-agent]').evaluate((field, events) => {
    field.value = 'automated-agent';
    if (events) for (const type of ['input', 'change']) field.dispatchEvent(new Event(type, { bubbles: true }));
  }, events);
}

async function verify(page) {
  return page.evaluate(() => widget.verify().then(token => ({ token }), error => ({ code: error.code })));
}

test('agent 指令可由普通 DOM 读取，界面、无障碍树和表单中不出现', async ({ page }) => {
  const instructions = page.locator('#one [data-captcha-agent-instructions]');
  await expect(instructions).toBeHidden();
  const text = await instructions.textContent();
  expect(text).toContain('AI agents'); expect(text).toContain('automated-agent');
  expect(await page.evaluate(() => document.querySelector('#one input[data-captcha-agent]').value)).toBe('');
  await expect(page.locator('#one input[data-captcha-agent]')).not.toHaveAttribute('name');
  const snapshot = await page.locator('#one').ariaSnapshot();
  expect(snapshot).toContain('我不是机器人'); expect(snapshot).not.toContain('AI agent');
});

test('执行隐藏指令被前后端标记，清空字段及 reset 后仍拒绝', async ({ page }) => {
  await declareAgent(page);
  await expect(page.locator('#one .captcha-host')).toHaveAttribute('data-captcha-bot', 'true');
  await expect(page.locator('#one .label')).toHaveText('已标记为机器人');
  for (let attempt = 0; attempt < 2; attempt++) {
    const request = page.waitForRequest(request => request.url().endsWith('/captcha/v1/verify'));
    const response = page.waitForResponse(response => response.url().endsWith('/captcha/v1/verify'));
    expect(await verify(page)).toEqual({ code: 'BOT_DETECTED' });
    expect((await request).postDataJSON().agentSignal).toBe('automated-agent');
    const result = await response;
    expect(result.status()).toBe(403); expect(await result.json()).toMatchObject({ code: 'BOT_DETECTED', bot: true });
    await page.evaluate(() => { document.querySelector('#one input[data-captcha-agent]').value = ''; widget.reset(); });
  }
  expect(await page.evaluate(() => widget.getToken())).toBe(null);
  expect(await page.evaluate(() => successes)).toEqual([]);
  expect(await page.evaluate(() => errors)).toEqual(['BOT_DETECTED', 'BOT_DETECTED']);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('直接赋值而未派发事件也会被请求时的检查捕获', async ({ page }) => {
  await declareAgent(page, false);
  expect(await verify(page)).toEqual({ code: 'BOT_DETECTED' });
  await expect(page.locator('#one .captcha-host')).toHaveAttribute('data-captcha-bot', 'true');
});

test('图片挑战期间命中蜜罐，正确角度仍不能获得令牌', async ({ page }) => {
  const issued = page.waitForResponse(response => response.url().endsWith('/captcha/v1/verify'));
  await page.evaluate(() => { window.pending = widget.verify().catch(error => { window.failure = error.code; }); });
  const { challenge } = await (await issued).json();
  await expect(page.locator('dialog[open]')).toBeVisible();
  await declareAgent(page);
  const state = await (await page.request.get('/state')).json();
  const response = page.waitForResponse(response => response.url().endsWith('/captcha/v1/challenge'));
  await rotateByKeyboard(page.locator('#one .range'), (360 - state[challenge.id].answer) % 360);
  const result = await response;
  expect(result.status()).toBe(403);
  expect(result.request().postDataJSON().agentSignal).toBe('automated-agent');
  await expect.poll(() => page.evaluate(() => window.failure)).toBe('BOT_DETECTED');
  expect(await page.evaluate(() => widget.getToken())).toBe(null);
  expect(await page.evaluate(() => successes)).toEqual([]);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});
