import { test, expect } from '@playwright/test';

async function mount(page) {
  await page.goto('/test');
  await page.evaluate(() => {
    window.successCount = 0;
    window.widget = Captcha.render('#one', { apiUrl: '/captcha/v1', action: 'demo', prewarm: false, onSuccess() { successCount++; } });
  });
}
async function submit(page) {
  const response = page.waitForResponse(r => r.url().endsWith('/captcha/v1/verify'));
  await page.evaluate(() => {
    window.pending = widget.verify();
    pending.then(value => { window.result = value; }, error => { window.failure = { code: error.code, name: error.name }; });
  });
  const { challenge } = await (await response).json();
  const state = await (await page.request.get('/state')).json();
  await page.locator('.range').evaluate((el, value) => {
    el.value = String(value); el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change'));
  }, (360 - state[challenge.id].answer) % 360);
}
test.beforeEach(async ({ page }) => {
  page.__errors = []; page.on('pageerror', error => page.__errors.push(error.message));
});
test.afterEach(async ({ page }) => { expect(page.__errors).toEqual([]); });
async function phase(page, value) {
  await expect.poll(() => page.locator('.stage').getAttribute('data-phase'), { intervals: [20] }).toBe(value);
}

test('4px 蓝色边缘加载环 → 黑色遮罩与描边对勾 → 关闭后才交付可消费令牌', async ({ page }, info) => {
  await mount(page); await submit(page);
  const stage = page.locator('.stage'), spinner = page.locator('.stage-spinner');
  await phase(page, 'loading');
  await expect(spinner).toHaveCSS('border-top-width', '4px');
  await expect(spinner).toHaveCSS('border-top-color', 'rgb(0, 111, 238)');
  await expect(page.locator('.range')).toBeDisabled();
  await phase(page, 'success');
  await expect(page.locator('.stage-check')).toBeVisible(); await expect(page.locator('.stage-cross')).toBeHidden();
  expect(await page.evaluate(() => widget.getToken())).toBe(null);
  expect(await page.evaluate(() => successCount)).toBe(0);
  await expect(page.locator('.stage-result')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.533)');
  if (info.project.name.includes('reduced')) {
    await expect(spinner).toHaveCSS('animation-name', 'none');
    await expect(page.locator('.stage-check')).toHaveCSS('animation-name', 'none');
  }
  await expect.poll(() => page.locator('.stage-check').evaluate(el => getComputedStyle(el).strokeDashoffset), { intervals: [20] }).toBe('0px');
  await page.screenshot({ path: `test-results/result-success-${info.project.name}.png` });
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect(page.locator('.widget')).toHaveClass(/verified/);
  expect(await page.evaluate(() => successCount)).toBe(1);
  const token = await page.evaluate(() => widget.getToken());
  expect((await page.request.post('/submit', { data: { token } })).status()).toBe(200);
  expect((await page.request.post('/submit', { data: { token } })).status()).toBe(400);
});

test('失败描边叉号后关闭、释放该挑战，宿主收到真实错误并能重新验证', async ({ page }, info) => {
  let attempts = 0;
  await page.route('**/captcha/v1/challenge', route => ++attempts === 1
    ? route.fulfill({ status: 400, json: { code: 'ANGLE_INCORRECT', error: '图片方向不正确' } }) : route.continue());
  await mount(page); await submit(page);
  await phase(page, 'loading');
  await phase(page, 'failure');
  await expect(page.locator('.stage-cross')).toBeVisible(); await expect(page.locator('.stage-check')).toBeHidden();
  await expect(page.getByRole('alert')).toHaveText('图片方向不正确');
  const cancelled = page.waitForResponse(r => r.url().endsWith('/captcha/v1/cancel'));
  await page.screenshot({ path: `test-results/result-failure-${info.project.name}.png` });
  await expect(page.locator('dialog')).toHaveCount(0);
  expect((await (await cancelled).json()).cancelled).toBe(true);
  await expect.poll(() => page.evaluate(() => window.failure?.code)).toBe('ANGLE_INCORRECT');
  expect(await page.evaluate(() => [widget.getToken(), successCount])).toEqual([null, 0]);
  await submit(page); await expect(page.locator('.widget')).toHaveClass(/verified/);
});

test('加载与结果展示中取消、reset、destroy 会终止等待且不会触发成功回调', async ({ page }) => {
  for (const [step, operation] of [['loading', 'cancel'], ['success', 'reset'], ['success', 'destroy']]) {
    await mount(page); await submit(page);
    await phase(page, step);
    if (operation === 'cancel') await page.keyboard.press('Escape');
    else await page.evaluate(operation => widget[operation](), operation);
    await expect(page.locator('dialog')).toHaveCount(0);
    if (operation === 'cancel') await expect.poll(() => page.evaluate(() => window.result)).toBe(null);
    else await expect.poll(() => page.evaluate(() => window.failure?.name)).toBe('AbortError');
    await page.waitForTimeout(750);
    expect(await page.evaluate(() => successCount)).toBe(0);
    expect(await page.locator('dialog').count()).toBe(0);
  }
});

test('反馈等待不延长服务端有效期，过短令牌显示失败且不触发成功', async ({ page }) => {
  await page.route('**/captcha/v1/challenge', route => route.fulfill({ json: { token: 'a'.repeat(64), expiresInMs: 150, usableAfterMs: 0 } }));
  await mount(page); await submit(page);
  await phase(page, 'failure');
  await expect(page.locator('.stage-check')).toBeHidden();
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.failure?.code)).toBe('TOKEN_EXPIRED');
  expect(await page.evaluate(() => [widget.getToken(), successCount])).toEqual([null, 0]);
});
