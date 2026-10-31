import { test, expect } from '@playwright/test';
import { rotateByKeyboard } from './keyboard-helper.js';

test.beforeEach(async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message)); page.__landingErrors = errors;
  await page.goto('/');
});
test.afterEach(async ({ page }) => { expect(page.__landingErrors).toEqual([]); });

async function start(page) {
  const response = page.waitForResponse(r => r.url().endsWith('/captcha/v1/verify'));
  await page.locator('#demo-captcha .widget').click();
  const { challenge } = await (await response).json();
  await expect(page.locator('dialog[open]')).toBeVisible();
  return challenge;
}

test('Landing 真实挑战、服务端消费、重放拒绝与重新体验', async ({ page }) => {
  const challenge = await start(page);
  const state = await (await page.request.get('/state')).json();
  const angle = (360 - state[challenge.id].answer) % 360;
  await rotateByKeyboard(page.locator('#demo-captcha input[type=range]'), angle);
  await expect(page.locator('#demo-status')).toHaveAttribute('data-state', 'verified');
  await expect(page.locator('#token-preview')).toHaveText(/^[a-f0-9]{8}…[a-f0-9]{8}$/);
  const request = page.waitForRequest(r => r.url().endsWith('/demo/verify'));
  await page.getByRole('button', { name: '提交到服务端核验' }).click();
  const { token } = (await request).postDataJSON();
  await expect(page.locator('#demo-status')).toHaveAttribute('data-state', 'consumed');
  await expect(page.locator('#submit-token')).toBeDisabled();
  const replay = await page.request.post('/demo/verify', { headers: { Origin: 'http://127.0.0.1:18877' }, data: { token } });
  expect(replay.status()).toBe(400);
  await page.getByRole('button', { name: '重试体验' }).click();
  await expect(page.locator('#demo-result')).toBeHidden();
  await expect(page.locator('#demo-captcha .widget')).toHaveClass(/idle/);
});

test('Demo 主题、取消、代码键盘切换和 FAQ 可操作', async ({ page }) => {
  await page.getByRole('button', { name: '深色主题' }).click();
  await expect(page.locator('.demo-card')).toHaveAttribute('data-theme', 'dark');
  await start(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('#demo-status')).toHaveAttribute('data-state', 'idle');
  await page.getByRole('tab', { name: 'ES Module' }).click();
  await expect(page.locator('#integration-code')).toContainText('import { render }');
  await page.getByRole('tab', { name: 'ES Module' }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: '服务端核验' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#integration-code')).toContainText('CAPTCHA_SECRET');
  await page.locator('summary').filter({ hasText: '这里的 Demo 是真实验证吗？' }).click();
  await expect(page.locator('details').first()).toHaveAttribute('open', '');
});

test('窄屏无横向溢出，首屏与完整页面保留截图', async ({ page }, testInfo) => {
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `width=${width}`).toBe(true);
  }
  await page.setViewportSize(testInfo.project.name === 'desktop' ? { width: 1440, height: 1000 } : { width: 390, height: 844 });
  await page.screenshot({ path: `test-results/landing-${testInfo.project.name}.png`, fullPage: true });
});
