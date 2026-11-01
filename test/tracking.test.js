import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChallengeTracking, createTracking } from '../src/client/tracking.js';
import { passesKeyboardBehavior } from '../src/signals.js';

test('浏览器提示采集实际视口、屏幕、时区和语言，变化后刷新且 Intl 不可用时兼容', t => {
  const doc = new EventTarget();
  const win = { PointerEvent: Event, matchMedia: () => ({ matches: false }), devicePixelRatio: 2, screen: { width: 1920, height: 1080 },
    innerWidth: 1200, innerHeight: 800, navigator: { languages: ['zh-CN', 'en'], language: 'zh-CN' }, Intl,
    Date: class { getTimezoneOffset() { return -480; } } };
  doc.defaultView = win;
  const tracking = createTracking({ ownerDocument: doc }); t.after(() => tracking.cleanup());
  const first = tracking.getHints();
  assert.equal(first.vw, 1200); assert.equal(first.vh, 800); assert.equal(first.sw, 1920); assert.equal(first.tz, -480);
  assert.equal(first.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  win.innerWidth = 600; win.navigator.languages.push('de');
  assert.equal(tracking.getHints().vw, 600); assert.equal(first.lang.length, 2);
  win.Intl = { DateTimeFormat() { throw new Error('unavailable'); } };
  assert.equal(tracking.getHints().timeZone, undefined);
  win.Intl = undefined;
  assert.equal(tracking.getHints().timeZone, undefined);
});

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

test('表单评测记录实际焦点往返且有界，不采集内容并隔离快照', t => {
  let time = 0;
  t.mock.method(performance, 'now', () => time);
  const doc = new EventTarget();
  doc.defaultView = { matchMedia: () => ({ matches: false }), PointerEvent: Event };
  const inputs = [new EventTarget(), new EventTarget()];
  const tracking = createTracking({ ownerDocument: doc }, { querySelectorAll: () => inputs });
  t.after(() => tracking.cleanup());
  const dispatch = (i, type) => { time += 100; inputs[i].dispatchEvent(new Event(type)); };
  dispatch(0, 'focus'); dispatch(0, 'input'); dispatch(0, 'input');
  dispatch(1, 'focus'); dispatch(1, 'input'); dispatch(1, 'input'); dispatch(0, 'focus');
  const first = tracking.getFormBehavior();
  assert.deepEqual(first.focusOrder, ['field0', 'field1', 'field0']);
  assert.equal(first.fields.field0.n, 2); assert.equal(first.fields.field0.meanGap, 100);
  assert.deepEqual(Object.keys(first.fields.field0).sort(), ['meanGap', 'n', 'varGap']);
  for (let i = 0; i < 50; i++) dispatch(i % 2, 'focus');
  const last = tracking.getFormBehavior();
  assert.equal(last.focusOrder.length, 32); assert.equal(first.focusOrder.length, 3);
  tracking.cleanup(); dispatch(0, 'input');
  assert.equal(tracking.getFormBehavior(), null);
});
