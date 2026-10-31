import { test, expect } from '@playwright/test';

test.afterEach(async ({ page }) => {
  // 成功响应使用固定令牌；显式释放真实测试服务的题目，避免占满同 IP 的挑战名额。
  const id = await page.evaluate(() => window.dragChallengeId);
  if (id) await page.request.post('/captcha/v1/cancel', { data: { id, action: 'default' } });
});

async function start(page) {
  await page.goto('/test');
  const response = page.waitForResponse(r => r.url().endsWith('/captcha/v1/verify'));
  await page.evaluate(() => {
    window.widget = Captcha.render('#one', { prewarm: false });
    window.pending = widget.verify(); pending.catch(() => {});
  });
  const { challenge } = await (await response).json();
  await page.evaluate(id => { window.dragChallengeId = id; }, challenge.id);
  const range = page.locator('.range');
  await expect(range).toBeVisible();
  await range.evaluate(el => Promise.all(el.closest('dialog').getAnimations().map(animation => animation.finished)));
  return range;
}

async function press(page, range, isMobile) {
  const rect = await range.boundingBox();
  const from = { x: rect.x + 32 + (rect.width - 64) * Number(await range.inputValue()) / 359, y: rect.y + 32 };
  await range.evaluate(el => el.addEventListener('pointerdown', event => { window.dragPointer = event.pointerId; }, { once: true }));
  const touch = isMobile ? await page.context().newCDPSession(page) : null;
  if (touch) await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  else { await page.mouse.move(from.x, from.y); await page.mouse.down(); }
  return {
    async move(x) {
      const point = { x, y: from.y };
      if (touch) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
      else await page.mouse.move(point.x, point.y);
    },
    async release() {
      if (touch) { await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await touch.detach(); }
      else await page.mouse.up();
    },
    rect,
  };
}

test('按住期间提前收到 change 不会提交，继续拖动后仅在松手时提交最终角度', async ({ page, isMobile }) => {
  const requests = [];
  await page.route('**/captcha/v1/challenge', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { token: 'a'.repeat(64), expiresInMs: 60000, usableAfterMs: 0 } });
  });
  const range = await start(page), gesture = await press(page, range, isMobile);
  await gesture.move(gesture.rect.x + 110);
  const firstAngle = await range.inputValue();
  // 模拟原生控件在指针仍按住时发出的提交事件。
  await range.dispatchEvent('change');
  await expect(range).toBeEnabled();
  expect(requests).toHaveLength(0);
  await gesture.move(gesture.rect.x + gesture.rect.width - 48);
  const finalAngle = Number(await range.inputValue());
  expect(finalAngle).toBeGreaterThan(Number(firstAngle));
  expect(requests).toHaveLength(0);
  await gesture.release();
  await expect(page.locator('.widget')).toHaveClass(/verified/);
  expect(requests).toHaveLength(1);
  expect(requests[0].angle).toBe(finalAngle);
});

for (const interrupted of ['lostpointercapture', 'pointercancel']) test(`拖动收到 ${interrupted} 后的 change 不会误提交，重新拖动仍可完成`, async ({ page, isMobile }) => {
  const requests = [];
  await page.route('**/captcha/v1/challenge', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { token: 'b'.repeat(64), expiresInMs: 60000, usableAfterMs: 0 } });
  });
  const range = await start(page), gesture = await press(page, range, isMobile);
  await gesture.move(gesture.rect.x + 110);
  await range.evaluate((el, type) => {
    el.dispatchEvent(new PointerEvent(type, { pointerId: window.dragPointer }));
    el.dispatchEvent(new Event('change'));
  }, interrupted);
  await expect(range).toBeEnabled();
  expect(requests).toHaveLength(0);
  await gesture.release();
  await expect(range).toBeEnabled();
  const resumed = await press(page, range, isMobile);
  await resumed.move(resumed.rect.x + resumed.rect.width - 48);
  await resumed.release();
  await expect(page.locator('.widget')).toHaveClass(/verified/);
  expect(requests).toHaveLength(1);
});
