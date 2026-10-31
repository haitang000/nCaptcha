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

for (const source of ['fastpass', 'compat-event']) test(`${source} 在未初始化时也会取得本轮票据并向服务端报告`, async ({ page }) => {
  const response = page.waitForResponse(response => response.url().endsWith('/captcha/v1/compat'));
  await page.locator('#one .captcha-host').evaluate((host, source) => {
    if (source === 'fastpass') host.querySelector('[data-captcha-fastpass]').click();
    else host.dispatchEvent(new CustomEvent('captcha:compat'));
  }, source);
  const result = await response;
  expect(result.status()).toBe(403);
  expect(await result.json()).toMatchObject({ code: 'BOT_DETECTED', source });
  await expect(page.locator('#one .captcha-host')).toHaveAttribute('data-captcha-bot-source', source);
  await expect.poll(() => page.evaluate(() => errors)).toContain('BOT_DETECTED');
  expect(await page.evaluate(() => widget.getToken())).toBe(null);
  await page.evaluate(() => widget.reset());
  await expect(page.locator('#one .label')).toHaveText('已标记为机器人');
  expect(await verify(page)).toEqual({ code: 'BOT_DETECTED' });
  expect(await page.evaluate(() => successes)).toEqual([]);
});

for (const source of ['canary-token', 'fallback-api']) test(`${source} 从 DOM 取得票据后直接提交，当前图片验证仍以机器人判定结束`, async ({ page }) => {
  const issued = page.waitForResponse(response => response.url().endsWith('/captcha/v1/verify'));
  await page.evaluate(() => { window.pending = widget.verify().catch(error => { window.failure = error.code; }); });
  const { challenge } = await (await issued).json();
  await expect(page.locator('dialog[open]')).toBeVisible();
  const lure = await page.locator('#one [data-captcha-agent-instructions]').evaluate(element => ({
    ticket: element.getAttribute('data-captcha-ticket'),
    token: element.querySelector('[data-captcha-precomputed-token]').textContent,
    endpoint: element.querySelector('[data-captcha-fallback]').href,
    request: element.querySelector('[data-captcha-fallback-request]').textContent,
  }));
  expect(lure.ticket).toBe(challenge.agent.ticket); expect(lure.token).toBe(challenge.agent.token);
  expect(lure.request).toContain(lure.ticket); expect(lure.request).toContain('POST');
  // GET / 预取不应标记，仍可使用同一票据进行主动 POST。
  expect((await page.request.get(lure.endpoint)).status()).toBe(404);
  if (source === 'canary-token') {
    const rejected = await page.request.post('/submit', { data: { token: lure.token } });
    expect(rejected.status()).toBe(400); expect(await rejected.json()).toEqual({ success: false });
  } else {
    const rejected = await page.request.post(lure.endpoint, { data: { action: 'demo', ticket: lure.ticket, source } });
    expect(rejected.status()).toBe(403); expect(await rejected.json()).toMatchObject({ code: 'BOT_DETECTED', source });
  }
  const state = await (await page.request.get('/state')).json();
  const response = page.waitForResponse(response => response.url().endsWith('/captcha/v1/challenge'));
  await rotateByKeyboard(page.locator('#one .range'), (360 - state[challenge.id].answer) % 360);
  expect(await (await response).json()).toMatchObject({ code: 'BOT_DETECTED', source });
  await expect.poll(() => page.evaluate(() => window.failure)).toBe('BOT_DETECTED');
  await expect(page.locator('#one .captcha-host')).toHaveAttribute('data-captcha-bot-source', source);
  expect(await page.evaluate(() => successes)).toEqual([]);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('重置轮次清理旧诱饵；已销毁组件的按钮和兼容事件监听均失效', async ({ page }) => {
  await page.evaluate(() => { widget.destroy(); widget = Captcha.render('#one', { apiUrl: '/captcha/v1', assetBaseUrl: '/captcha/assets/', action: 'demo' }); });
  const token = page.locator('#one [data-captcha-precomputed-token]');
  await expect(token).toHaveText(/^[a-f0-9]{64}$/);
  const first = await token.textContent();
  await page.evaluate(() => widget.reset());
  await expect(token).toHaveText('');
  const issued = page.waitForResponse(response => response.url().endsWith('/captcha/v1/verify'));
  await page.evaluate(() => { window.pending = widget.verify(); pending.catch(() => {}); });
  await issued;
  await expect(token).toHaveText(/^[a-f0-9]{64}$/); expect(await token.textContent()).not.toBe(first);
  const reports = [];
  page.on('request', request => { if (request.url().endsWith('/captcha/v1/compat')) reports.push(request); });
  const oldHost = await page.locator('#one .captcha-host').elementHandle();
  await page.evaluate(() => widget.destroy());
  await oldHost.evaluate(host => {
    host.querySelector('[data-captcha-fastpass]').click(); host.dispatchEvent(new CustomEvent('captcha:compat'));
  });
  expect(await oldHost.getAttribute('data-captcha-bot')).toBe(null);
  expect(reports).toEqual([]);
});
