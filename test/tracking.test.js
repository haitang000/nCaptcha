import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChallengeTracking } from '../src/client/tracking.js';
import { passesKeyboardBehavior } from '../src/signals.js';

test('图片轨迹按轮次隔离，限制点数，正确识别输入方式并清理监听', t => {
  let time = 0;
  t.mock.method(performance, 'now', () => time);
  const element = new EventTarget();
  element.ownerDocument = { defaultView: { matchMedia: () => ({ matches: false }) } };
  element.matches = () => true;
  const tracking = createChallengeTracking(element);
  t.after(() => tracking.cleanup());
  function event(type, data = {}) { time += 20; element.dispatchEvent(Object.assign(new Event(type), data)); }
  for (let i = 0; i < 700; i++) event('pointermove', { clientX: i, clientY: 200, pointerType: 'mouse' });
  const snapshot = tracking.snapshot();
  assert.equal(snapshot.pointer, 'mouse'); assert.equal(snapshot.trajectory.length, 100);
  assert.equal(snapshot.trajectory[0].t, 0); assert.equal(snapshot.trajectory.at(-1).x, 699);
  assert.ok(snapshot.trajectory.every((point, i) => !i || point.t > snapshot.trajectory[i - 1].t));
  tracking.reset(); assert.equal(tracking.snapshot().trajectory, null);
  for (const type of ['pointerdown', 'pointermove', 'pointerup']) event(type, { clientX: time, clientY: 200, pointerType: 'touch' });
  assert.equal(tracking.snapshot().pointer, 'touch'); assert.equal(tracking.snapshot().trajectory.length, 3);
  tracking.recordKey('Home', 'range', 0);
  tracking.recordKey('ArrowRight', 'range', 0); tracking.recordKey('ArrowLeft', 'range', 1); time += 100;
  tracking.recordKey('Enter', 'range', 0);
  const keyboard = tracking.snapshot();
  assert.equal(keyboard.pointer, 'keyboard'); assert.equal(keyboard.keyboard.startAngle, 0);
  assert.deepEqual(keyboard.keyboard.events.map(event => event.key), ['Home', 'ArrowRight', 'ArrowLeft', 'Enter']);
  assert.equal(passesKeyboardBehavior(keyboard.keyboard, 0, 200, true), true, '降精度时钟中的多个按键仍可重放');
  assert.equal(keyboard.trajectory.length, 3, '键盘接续指针操作时保留已有轨迹');
  tracking.cleanup();
  event('pointermove', { clientX: 10, clientY: 10, pointerType: 'mouse' });
  assert.deepEqual(tracking.snapshot(), { pointer: 'keyboard', trajectory: null, keyboard: null });
});
