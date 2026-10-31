import { test, expect } from '@playwright/test';
import { rotateByKeyboard } from './keyboard-helper.js';

async function start(page) {
  await page.goto('/test');
  await page.evaluate(() => { window.widget = Captcha.render('#one', { apiUrl: '/captcha/v1', action: 'demo', prewarm: false }); });
  await page.mouse.move(5, 5);
  const response = page.waitForResponse(r => r.url().endsWith('/captcha/v1/verify'));
  await page.evaluate(() => { window.pending = widget.verify(); pending.catch(() => {}); });
  const { challenge } = await (await response).json();
  await expect(page.locator('dialog[open]')).toBeVisible();
  return challenge;
}

async function drag(page, challenge, isMobile, offset = 0) {
  const state = await (await page.request.get('/state')).json();
  const angle = (360 - state[challenge.id].answer + offset) % 360;
  const rect = await page.locator('.range').boundingBox();
  const from = { x: rect.x + 32, y: rect.y + 32 };
  const to = { x: from.x + (rect.width - 64) * angle / 359, y: from.y };
  const middle = { x: rect.x + rect.width - 50, y: from.y };
  const touch = isMobile ? await page.context().newCDPSession(page) : null;
  if (touch) await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  else { await page.mouse.move(from.x, from.y); await page.mouse.down(); }
  let previous = from;
  for (const target of [middle, to]) {
    for (let i = 1; i <= 8; i++) {
      const point = { x: previous.x + (target.x - previous.x) * i / 8, y: from.y };
      if (touch) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
      else await page.mouse.move(point.x, point.y);
      await page.waitForTimeout(12 + i % 3 * 7);
    }
    previous = target;
  }
  if (touch) { await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await touch.detach(); }
  else await page.mouse.up();
}

test('图片阶段鼠标/触屏轨迹随答案提交并由真实服务端验证', async ({ page, isMobile }) => {
  const challenge = await start(page);
  const response = page.waitForResponse(r => r.url().endsWith('/captcha/v1/challenge'));
  await drag(page, challenge, isMobile);
  const submitted = await response, body = submitted.request().postDataJSON();
  expect(submitted.status()).toBe(200);
  expect(body.pointer).toBe(isMobile ? 'touch' : 'mouse'); expect(body.hints.pointer).toBe(body.pointer);
  expect(body.trajectory.length).toBeGreaterThanOrEqual(3); expect(body.trajectory.length).toBeLessThanOrEqual(100);
  expect(body.trajectory[0].t).toBe(0); expect(body.trajectory.at(-1).t).toBeGreaterThanOrEqual(80);
  expect(body.trajectory.every((p, i) => (p.x !== 5 || p.y !== 5) && (!i || p.t > body.trajectory[i - 1].t))).toBe(true);
  await expect(page.locator('.widget')).toHaveClass(/verified/);
});

test('过快自动重试复用同一份图片阶段轨迹', async ({ page, isMobile }) => {
  const bodies = [];
  await page.route('**/captcha/v1/challenge', async route => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) await route.fulfill({ status: 400, json: { code: 'TOO_FAST', error: '请稍等再提交', retryAfterMs: 80 } });
    else await route.continue();
  });
  await drag(page, await start(page), isMobile);
  await expect(page.locator('.widget')).toHaveClass(/verified/);
  expect(bodies).toHaveLength(2); expect(bodies[1]).toEqual(bodies[0]);
});

test('换题清空旧轨迹，缺失本轮轨迹自动换题后仍可正常通过', async ({ page, isMobile }) => {
  const first = await start(page);
  let replacement = page.waitForResponse(r => r.url().endsWith('/captcha/v1/verify'));
  await drag(page, first, isMobile, 180);
  const { challenge: second } = await (await replacement).json();
  await expect(page.locator('.range')).toBeEnabled();
  const state = await (await page.request.get('/state')).json();
  const rejected = page.waitForResponse(async r => r.url().endsWith('/captcha/v1/challenge') && (await r.json()).code === 'BEHAVIOR_REJECTED');
  replacement = page.waitForResponse(r => r.url().endsWith('/captcha/v1/verify'));
  await page.locator('.range').evaluate((el, angle) => {
    el.value = String(angle); el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change'));
  }, (360 - state[second.id].answer) % 360);
  const response = await rejected;
  expect(response.request().postDataJSON().trajectory).toBe(null);
  expect((await response.json()).code).toBe('BEHAVIOR_REJECTED');
  const { challenge: third } = await (await replacement).json();
  await expect(page.locator('.range')).toBeEnabled();
  await drag(page, third, isMobile);
  await expect(page.locator('.widget')).toHaveClass(/verified/);
});

test('键盘使用可重放的调整记录，无鼠标轨迹也可通过', async ({ page }) => {
  const challenge = await start(page);
  const state = await (await page.request.get('/state')).json();
  const response = page.waitForResponse(r => r.url().endsWith('/captcha/v1/challenge') && r.status() === 200);
  await rotateByKeyboard(page.locator('.range'), (360 - state[challenge.id].answer) % 360);
  const submitted = await response;
  expect(submitted.request().postDataJSON()).toMatchObject({ pointer: 'keyboard', trajectory: null });
  expect(submitted.request().postDataJSON().keyboard.events.at(-1).key).toBe('Enter');
  expect(submitted.status()).toBe(200);
  await expect(page.locator('.widget')).toHaveClass(/verified/);
});

test('公开接口拒绝只改报 keyboard，随后真实键盘操作仍可完成同一题', async ({ page }) => {
  const challenge = await start(page);
  const state = await (await page.request.get('/state')).json();
  const angle = (360 - state[challenge.id].answer) % 360;
  await page.waitForTimeout(120);
  const response = await page.request.post('/captcha/v1/challenge', { data: { action: 'demo', id: challenge.id, angle, pointer: 'keyboard' } });
  expect(response.status()).toBe(400);
  expect((await response.json()).code).toBe('BEHAVIOR_REJECTED');
  await rotateByKeyboard(page.locator('.range'), angle);
  await expect(page.locator('.widget')).toHaveClass(/verified/);
});
