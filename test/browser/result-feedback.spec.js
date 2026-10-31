import { test, expect } from '@playwright/test';

async function mount(page) {
  await page.goto('/test');
  await page.evaluate(() => {
    window.successCount = 0;
    window.errorCount = 0;
    window.widget = Captcha.render('#one', { apiUrl: '/captcha/v1', action: 'demo', prewarm: false, onSuccess() { successCount++; }, onError() { errorCount++; } });
  });
}
async function submit(page, angleOffset = 0) {
  const response = page.waitForResponse(r => r.url().endsWith('/captcha/v1/verify'));
  await page.evaluate(() => {
    window.pending = widget.verify();
    pending.then(value => { window.result = value; }, error => { window.failure = { code: error.code, name: error.name }; });
  });
  const { challenge } = await (await response).json();
  await page.locator('dialog').evaluate(el => { window.originalDialog = el; window.dialogCloses = 0; el.addEventListener('close', () => dialogCloses++); });
  await answer(page, challenge, angleOffset);
  return challenge;
}
async function answer(page, challenge, angleOffset = 0) {
  const state = await (await page.request.get('/state')).json();
  await page.locator('.range').evaluate((el, value) => {
    el.value = String(value); el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change'));
  }, (360 - state[challenge.id].answer + angleOffset) % 360);
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

test('失败后在原弹窗中左移换题，释放旧题并在下一轮通过', async ({ page }, info) => {
  await mount(page);
  const replacement = page.waitForResponse(r => r.url().endsWith('/captcha/v1/verify') && r.request().postDataJSON().trajectory === undefined);
  const cancelled = page.waitForResponse(r => r.url().endsWith('/captcha/v1/cancel'));
  const first = await submit(page, 180);
  await phase(page, 'loading');
  await phase(page, 'failure');
  await expect(page.locator('.stage-cross')).toBeVisible(); await expect(page.locator('.stage-check')).toBeHidden();
  await expect(page.getByRole('alert')).toHaveText('方向还未回正，请微调后重试');
  await page.screenshot({ path: `test-results/result-failure-${info.project.name}.png` });
  const { challenge: next } = await (await replacement).json();
  expect((await (await cancelled).json()).cancelled).toBe(true);
  expect(next.id).not.toBe(first.id); expect(next.image).not.toBe(first.image);
  if (!info.project.name.includes('reduced')) {
    await phase(page, 'switching');
    const slides = await page.locator('.stage-viewport').evaluate(el => [...el.getAnimations({ subtree: true })].filter(a => a.effect.getKeyframes().some(k => k.transform?.includes('translateX'))).map(a => a.effect.getKeyframes().map(k => new DOMMatrix(k.transform).m41)));
    expect(slides).toHaveLength(2);
    expect(slides.some(frames => frames[0] === 0 && frames[1] < 0)).toBe(true);
    expect(slides.some(frames => frames[0] > 0 && frames[1] === 0)).toBe(true);
    await page.screenshot({ path: `test-results/result-switching-${info.project.name}.png` });
  }
  await expect(page.locator('.range')).toBeEnabled();
  expect(await page.evaluate(() => [originalDialog === document.querySelector('.captcha-host').shadowRoot.querySelector('dialog'), originalDialog.open, dialogCloses])).toEqual([true, true, 0]);
  expect(await page.evaluate(() => [widget.getToken(), successCount, errorCount, window.failure])).toEqual([null, 0, 0, undefined]);
  await expect(page.locator('.widget')).toHaveClass(/loading/);
  await expect(page.locator('.range')).toHaveValue('0');
  await expect(page.locator('.stage')).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('.stage img')).toHaveAttribute('src', next.image);
  await expect(page.locator('.stage-outgoing')).toHaveCount(0);
  await answer(page, next); await expect(page.locator('.widget')).toHaveClass(/verified/);
  expect(await page.evaluate(() => [successCount, errorCount])).toEqual([1, 0]);
});

test('连续失败会继续换题，取消时释放最新题目且结束同一个验证任务', async ({ page }) => {
  await page.route('**/captcha/v1/challenge', route => route.fulfill({ status: 400, json: { code: 'CHALLENGE_EXHAUSTED', error: '请重新验证' } }));
  await mount(page); await submit(page);
  for (let round = 0; round < 2; round++) {
    const response = await page.waitForResponse(r => r.url().endsWith('/captcha/v1/verify'));
    const { challenge } = await response.json();
    await expect(page.locator('.range')).toBeEnabled();
    expect(await page.evaluate(() => [originalDialog.open, dialogCloses])).toEqual([true, 0]);
    if (!round) await answer(page, challenge);
    else {
      const cancelled = page.waitForRequest(r => r.url().endsWith('/captcha/v1/cancel'));
      await page.keyboard.press('Escape');
      expect((await cancelled).postDataJSON().id).toBe(challenge.id);
    }
  }
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.result)).toBe(null);
  expect(await page.evaluate(() => [successCount, errorCount])).toEqual([0, 0]);
});

test('取消时卡片与遮罩播放退场动画后才移除', async ({ page }, info) => {
  await mount(page);
  await page.evaluate(() => { window.pending = widget.verify(); pending.catch(() => {}); });
  await expect(page.locator('dialog[open]')).toBeVisible();
  const closing = await page.locator('dialog').evaluate(el => {
    el.dispatchEvent(new Event('cancel', { cancelable: true }));
    return { open: el.open, connected: el.isConnected, animations: el.getAnimations().map(a => a.animationName), backdrop: getComputedStyle(el, '::backdrop').animationName };
  });
  if (!info.project.name.includes('reduced')) {
    expect(closing.open).toBe(true); expect(closing.connected).toBe(true);
    expect(closing.animations).toContain('puzzle-exit'); expect(closing.backdrop).toBe('backdrop-exit');
  }
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect(page.locator('.widget')).toHaveClass(/idle/);
});

test('换图动画中取消、reset、destroy 不会恢复滑块或复活弹窗', async ({ page }, info) => {
  test.skip(info.project.name.includes('reduced'), '减少动态效果时不播放换图动画');
  for (const operation of ['cancel', 'reset', 'destroy']) {
    await mount(page); await submit(page, 180);
    await phase(page, 'switching');
    if (operation === 'cancel') await page.keyboard.press('Escape');
    else await page.evaluate(operation => widget[operation](), operation);
    await expect(page.locator('dialog')).toHaveCount(0);
    if (operation === 'cancel') await expect.poll(() => page.evaluate(() => window.result)).toBe(null);
    else await expect.poll(() => page.evaluate(() => window.failure?.name)).toBe('AbortError');
    await page.waitForTimeout(350);
    expect(await page.evaluate(() => [successCount, errorCount])).toEqual([0, 0]);
    await expect(page.locator('dialog')).toHaveCount(0);
  }
});

test('换题遇到限流时结束验证并交付真实错误', async ({ page }) => {
  let proofs = 0;
  await page.route('**/captcha/v1/pow*', route => ++proofs === 1 ? route.continue()
    : route.fulfill({ status: 429, json: { code: 'RATE_LIMITED', error: '验证请求过于频繁，请稍后再试' } }));
  await mount(page); await submit(page, 180);
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.failure?.code)).toBe('RATE_LIMITED');
  expect(await page.evaluate(() => [widget.getToken(), successCount, errorCount])).toEqual([null, 0, 1]);
  await expect(page.locator('.widget')).toHaveClass(/error/);
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
