// 用实际按键完成角度调整，避免测试通过直接改 value 跳过交互校验。
export async function rotateByKeyboard(range, angle) {
  await range.press('Home');
  for (let i = 0; i < Math.floor(angle / 10); i++) await range.press('PageUp');
  for (let i = 0; i < angle % 10; i++) await range.press('ArrowRight');
  await range.page().waitForTimeout(90);
  await range.press('Enter');
}
