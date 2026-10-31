import { test, expect } from '@playwright/test';
const options = { apiUrl: '/captcha/v1', assetBaseUrl: '/captcha/assets/', action: 'demo', prewarm: false };
test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.__captchaErrors = errors;
});
test.afterEach(async ({ page }) => { expect(page.__captchaErrors).toEqual([]); });
async function mount(page, extra = {}) {
  await page.goto('/test');
  await page.evaluate(opts => { window.widget = Captcha.render('#one', { ...opts, form: '#form' }); }, { ...options, ...extra });
}
async function start(page, variable = 'widget') {
  const response = page.waitForResponse(r => r.url().endsWith('/captcha/v1/verify'));
  await page.evaluate(name => { window.pending = window[name].verify(); window.pending.then(value => { window.result = value; }, err => { window.failed = { name: err.name, code: err.code }; }); }, variable);
  const { challenge } = await (await response).json();
  await expect(page.locator('dialog[open]').last()).toBeVisible();
  return challenge;
}
async function answer(page, challenge, host = '#one') {
  const state = await (await page.request.get('/state')).json();
  const angle = (360 - state[challenge.id].answer) % 360;
  const root = page.locator(host);
  await page.waitForTimeout(120);
  await root.locator('input[type=range]').evaluate((el, value) => { el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, angle);
}

test('完整验证等待令牌可用后回调，服务端消费且拒绝重放', async ({ page }) => {
  await mount(page);
  const challenge = await start(page);
  await answer(page, challenge);
  await expect(page.locator('#one .widget')).toHaveClass(/verified/);
  const token = await page.evaluate(() => widget.getToken()); expect(token).toHaveLength(64);
  const first = await page.request.post('/submit', { data: { token } }); expect(first.status()).toBe(200);
  const replay = await page.request.post('/submit', { data: { token } }); expect(replay.status()).toBe(400);
  await page.screenshot({ path: `test-results/verified-${test.info().project.name}.png` });
});
test('取消后可重新验证，键盘微调与组件销毁重建', async ({ page }) => {
  await mount(page);
  await start(page);
  const stage = page.locator('.stage'); await stage.focus(); await stage.press('ArrowRight'); await expect(stage).toHaveAttribute('aria-valuenow', '15');
  await stage.press('ArrowLeft'); await expect(stage).toHaveAttribute('aria-valuenow', '0');
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.result)).toBe(null);
  const challenge = await start(page);
  await answer(page, challenge); await expect(page.locator('#one .widget')).toHaveClass(/verified/);
  await page.evaluate(opts => { widget.destroy(); widget = Captcha.render('#one', opts); }, options);
  expect(await page.locator('#one .widget').count()).toBe(1);
  expect(await page.evaluate(() => widget.getToken())).toBe(null);
});
test('两个组件并行出题，独立弹窗与计算结果互不覆盖', async ({ page }) => {
  await mount(page);
  await page.evaluate(opts => { window.second = Captcha.render('#two', { ...opts, action: 'other' }); }, options);
  const first = await start(page);
  const second = await start(page, 'second');
  expect(first.id).not.toBe(second.id); expect(await page.locator('dialog[open]').count()).toBe(2);
  await answer(page, second, '#two'); await expect(page.locator('#two .widget')).toHaveClass(/verified/);
  await answer(page, first); await expect(page.locator('#one .widget')).toHaveClass(/verified/);
  const tokens = await page.evaluate(() => [widget.getToken(), second.getToken()]); expect(tokens[0]).not.toBe(tokens[1]);
});
test('令牌到期自动清除，减少动态效果偏好及主题正常生效', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => { window.expired = 0; widget.destroy(); widget = Captcha.render('#one', { apiUrl: '/captcha/v1', assetBaseUrl: '/captcha/assets/', action: 'demo', prewarm: false, onExpire() { window.expired++; } }); });
  await answer(page, await start(page)); await expect(page.locator('#one .widget')).toHaveClass(/verified/);
  await expect.poll(() => page.evaluate(() => window.expired), { timeout: 6000 }).toBe(1);
  expect(await page.evaluate(() => widget.getToken())).toBe(null);
  await expect(page.locator('#one .label')).toHaveText('我不是机器人');
  const style = await page.locator('#one .widget').evaluate(el => ({ color: getComputedStyle(el).color, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, duration: getComputedStyle(el).transitionDuration }));
  if (style.reduced) expect(style.duration).toBe('0s');
});
test('Worker 加载受限时回退，进行中销毁会取消任务且不会复活 DOM', async ({ page }) => {
  await mount(page, { workerUrl: '/missing-worker.js' });
  const challenge = await start(page); await answer(page, challenge); await expect(page.locator('#one .widget')).toHaveClass(/verified/);
  await page.evaluate(() => widget.reset());
  await start(page);
  await page.evaluate(() => widget.destroy());
  await expect.poll(() => page.evaluate(() => window.failed?.name)).toBe('AbortError');
  await expect(page.locator('#one .widget')).toHaveCount(0);
  await expect(page.locator('dialog')).toHaveCount(0);
});
test('鼠标或触屏拖动可旋转图片，默认主题布局不溢出', async ({ page, isMobile }) => {
  await page.route('**/captcha/v1/challenge', route => route.fulfill({ status: 400, json: { code: 'ANGLE_INCORRECT', error: '方向还未回正，请微调后重试' } }));
  await mount(page);
  await start(page);
  const stage = page.locator('.stage');
  const r = await stage.boundingBox();
  if (isMobile) {
    const touch = await page.context().newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + r.width / 2, y: r.y + 15 }] });
    for (let i = 1; i <= 8; i++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: r.x + r.width / 2 + (r.width / 2 - 15) * i / 8, y: r.y + 15 + (r.height / 2 - 15) * i / 8 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touch.detach();
  } else {
    await page.mouse.move(r.x + r.width / 2, r.y + 15); await page.mouse.down();
    await page.mouse.move(r.x + r.width - 15, r.y + r.height / 2, { steps: 8 }); await page.mouse.up();
  }
  expect(Number(await stage.getAttribute('aria-valuenow'))).toBeGreaterThan(60);
  const rect = await page.locator('dialog').boundingBox(); expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.width).toBeLessThanOrEqual(page.viewportSize().width);
  await page.screenshot({ path: `test-results/puzzle-${test.info().project.name}.png` });
  await page.keyboard.press('Escape');
});
test('主题变量继承有效，宿主通用样式不污染组件', async ({ page }) => {
  await mount(page);
  await page.addStyleTag({ content: '#one { --captcha-accent: rgb(120, 45, 200); --captcha-radius: 9px; } button { background: red !important; font-size: 80px !important; }' });
  await expect.poll(() => page.locator('#one .widget').evaluate(el => getComputedStyle(el).borderRadius)).toBe('9px');
  expect(await page.locator('#one .widget').evaluate(el => getComputedStyle(el).fontSize)).toBe('14px');
  expect(await page.locator('#one .widget').evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgb(255, 0, 0)');
});
test('计算中 reset 终止独立 Worker 并拒绝旧任务', async ({ page }) => {
  await page.addInitScript(() => {
    const Original = window.Worker; window.activeWorkers = 0;
    window.Worker = class extends Original {
      constructor(...args) { super(...args); window.activeWorkers++; this.ended = false; }
      terminate() { if (!this.ended) { this.ended = true; window.activeWorkers--; } return super.terminate(); }
    };
  });
  await page.route('**/captcha/v1/pow*', async route => {
    const response = await route.fetch(); const json = await response.json(); json.bits = 28;
    await route.fulfill({ response, json });
  });
  await mount(page);
  await page.evaluate(() => { window.pending = widget.verify(); window.pending.catch(err => { window.failed = err.name; }); });
  await expect.poll(() => page.evaluate(() => window.activeWorkers)).toBe(1);
  await page.evaluate(() => widget.reset());
  await expect.poll(() => page.evaluate(() => window.failed)).toBe('AbortError');
  expect(await page.evaluate(() => window.activeWorkers)).toBe(0);
  expect(await page.evaluate(() => widget.getToken())).toBe(null);
});
for (const path of ['/examples', '/module', 'http://127.0.0.1:18878/']) test(`可运行示例提交：${path}`, async ({ page }) => {
  await page.goto(path);
  const response = page.waitForResponse(r => r.url().endsWith('/captcha/v1/verify'));
  await page.getByRole('button', { name: '验证并提交', exact: true }).click();
  const challenge = (await (await response).json()).challenge;
  const state = await (await page.request.get('http://127.0.0.1:18877/state')).json();
  const angle = (360 - state[challenge.id].answer) % 360;
  await page.waitForTimeout(120);
  await page.locator('#captcha input[type=range]').evaluate((el, value) => { el.value = String(value); el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); }, angle);
  await expect(page.locator('#result')).toHaveText('业务提交成功：后端已核验并消费令牌');
});
test('参考图卡片比例、六点滑块和纯图片圆形预览', async ({ page, isMobile }) => {
  await mount(page);
  await start(page);
  const dialog = page.locator('dialog[open]');
  await expect(dialog.getByRole('heading')).toHaveText('拖动滑块, 使图片方向为正');
  await expect(dialog.locator('.puzzle-eyebrow')).toHaveText('请进行安全验证');
  await expect(dialog.locator('.needle, .notch, .steppers, [data-done]')).toHaveCount(0);
  const dimensions = await dialog.evaluate(el => ({ width: el.offsetWidth, height: el.offsetHeight, stage: el.querySelector('.stage').offsetWidth, slider: el.querySelector('.range').offsetHeight }));
  expect(dimensions.height).toBe(440); expect(dimensions.stage).toBe(200); expect(dimensions.slider).toBe(64);
  if (!isMobile) expect(dimensions.width).toBe(400);
  await dialog.screenshot({ path: `test-results/puzzle-reference-${test.info().project.name}.png` });
  await page.keyboard.press('Escape');
});
test('滑块键盘微调不提前提交，Enter 确认且网络过程中禁止重复提交', async ({ page }) => {
  let requests = 0;
  await page.route('**/captcha/v1/challenge', async route => { requests++; await new Promise(resolve => setTimeout(resolve, 200)); await route.continue(); });
  await mount(page);
  const challenge = await start(page);
  const range = page.locator('.range');
  await range.focus(); await range.press('ArrowRight');
  expect(await range.inputValue()).toBe('1'); expect(requests).toBe(0);
  const state = await (await page.request.get('/state')).json();
  await range.evaluate((el, answer) => { el.value = String(answer); el.dispatchEvent(new Event('input')); }, (360 - state[challenge.id].answer) % 360);
  await range.press('Enter');
  await expect(range).toBeDisabled();
  await range.evaluate(el => { el.dispatchEvent(new Event('change')); el.dispatchEvent(new Event('change')); });
  await expect(page.locator('.widget')).toHaveClass(/verified/); expect(requests).toBe(1);
});
test('过快松手自动等待，错误反馈后关闭弹窗并可重新验证', async ({ page }) => {
  let requests = 0;
  await page.route('**/captcha/v1/challenge', async route => {
    requests++;
    if (requests === 1) { await route.fulfill({ status: 400, json: { code: 'TOO_FAST', error: '请稍等再提交', retryAfterMs: 80 } }); return; }
    if (requests === 2) { await route.fulfill({ status: 400, json: { code: 'ANGLE_INCORRECT', error: '方向还未回正，请微调后重试' } }); return; }
    await route.continue();
  });
  await mount(page);
  await start(page);
  const range = page.locator('.range');
  await range.evaluate(el => { el.value = '123'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
  await expect.poll(() => page.locator('.stage').getAttribute('data-phase'), { intervals: [20] }).toBe('failure');
  await expect(page.getByRole('alert')).toHaveText('方向还未回正，请微调后重试');
  expect(requests).toBe(2); expect(await range.inputValue()).toBe('123'); await expect(range).toBeDisabled();
  await expect(page.locator('dialog')).toHaveCount(0); await expect(page.locator('.widget')).toHaveClass(/error/);
  await answer(page, await start(page)); await expect(page.locator('.widget')).toHaveClass(/verified/);
});
test('鼠标和触屏实际拖动滑块在松手时只提交一次', async ({ page, isMobile }) => {
  const requests = [];
  await page.route('**/captcha/v1/challenge', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 400, json: { code: 'ANGLE_INCORRECT', error: '请继续调整图片方向' } });
  });
  await mount(page); await start(page);
  const range = page.locator('.range'), rect = await range.boundingBox();
  const from = { x: rect.x + 32, y: rect.y + 32 }, to = { x: rect.x + rect.width - 1, y: rect.y + 32 };
  if (isMobile) {
    const touch = await page.context().newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    for (let i = 1; i <= 8; i++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 8, y: from.y }] });
    expect(requests.length).toBe(0);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await touch.detach();
  } else {
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 8 });
    expect(requests.length).toBe(0); await page.mouse.up();
  }
  await expect.poll(() => page.locator('.stage').getAttribute('data-phase'), { intervals: [20] }).toBe('failure');
  await expect(page.getByRole('alert')).toHaveText('请继续调整图片方向');
  expect(requests.length).toBe(1); expect(requests[0].angle).toBe(359);
  await page.keyboard.press('Escape');
});
