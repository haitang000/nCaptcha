import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateContext } from '../src/core.js';
import { decodePng, rotatePuzzleToPng } from '../src/image-codec.js';
import { getClientIp } from '../src/http.js';
import { fixture, ctx, verify, challengeTrajectory, keyboardForAngle } from './helpers.js';

const code = expected => error => error.code === expected;
async function challengeFor(t) {
  const f = fixture(); t.after(() => f.close());
  const { challenge } = await verify(f.captcha);
  return { ...f, input: { ...ctx, id: challenge.id, angle: -f.answer(challenge.id) } };
}

test('伪造键盘或触屏标记不能跳过轨迹检查', async t => {
  for (const pointer of ['mouse', 'touch', 'pen', 'keyboard']) {
    const f = await challengeFor(t);
    await assert.rejects(f.captcha.solveChallenge({ ...f.input, pointer }), code('BEHAVIOR_REJECTED'));
    assert.ok((await f.captcha.solveChallenge({ ...f.input, pointer, trajectory: challengeTrajectory,
      keyboard: pointer === 'keyboard' ? keyboardForAngle(f.input.angle) : null })).token);
  }
});

test('请求体中的关闭开关和模式不能改变服务端配置或绕过 PoW', async t => {
  const f = fixture(); t.after(() => f.close());
  await assert.rejects(f.captcha.verifyBehavior({ ...ctx, enabled: false, mode: 'normal' }), code('INVALID_INPUT'));
  const result = await verify(f.captcha, ctx, { enabled: false, mode: 'normal' });
  assert.ok(result.challenge); assert.equal(result.token, undefined);
});

test('机械轨迹改报触屏或笔仍会被拒绝', async t => {
  const trajectory = Array.from({ length: 8 }, (_, i) => ({ x: 100 + i * 10, y: 200, t: i * 30 }));
  for (const pointer of ['mouse', 'touch', 'pen']) {
    const f = await challengeFor(t);
    await assert.rejects(f.captcha.solveChallenge({ ...f.input, pointer, trajectory }), code('BEHAVIOR_REJECTED'));
  }
});

test('键盘序列必须合法、时间合理且能重放到提交角度', async t => {
  for (const kind of ['missing', 'empty', 'time', 'future', 'final-angle', 'start-angle', 'early-enter', 'key', 'control', 'limit']) {
    const f = await challengeFor(t);
    let keyboard = keyboardForAngle(f.input.angle);
    if (kind === 'missing') keyboard = null;
    if (kind === 'empty') keyboard.events = [];
    if (kind === 'time') keyboard.events.forEach(event => { event.t = 100; });
    if (kind === 'future') keyboard.events.at(-1).t = 10000;
    if (kind === 'final-angle') keyboard = keyboardForAngle((360 + f.input.angle + 1) % 360);
    if (kind === 'start-angle') keyboard.startAngle = 120;
    if (kind === 'early-enter') keyboard.events[0].key = 'Enter';
    if (kind === 'key') keyboard.events[0].key = 'Magic';
    if (kind === 'control') keyboard.events[0].control = 'script';
    if (kind === 'limit') keyboard.events = Array.from({ length: 513 }, (_, i) => ({ key: 'Home', control: 'range', t: i }));
    await assert.rejects(f.captcha.solveChallenge({ ...f.input, pointer: 'keyboard', keyboard }), code('BEHAVIOR_REJECTED'));
  }
});

test('键盘可接续已校验的指针操作，但不能只伪造非零起始角度', async t => {
  const f = await challengeFor(t);
  const angle = ((f.input.angle % 360) + 360) % 360;
  const keyboard = { startAngle: angle, events: [{ key: 'Enter', control: 'range', t: 100 }] };
  // 用固定非零起点证明缺少指针轨迹时不能授权键盘接续。
  await assert.rejects(f.captcha.solveChallenge({ ...f.input, pointer: 'keyboard', keyboard: { ...keyboard, startAngle: 120 } }), code('BEHAVIOR_REJECTED'));
  assert.ok((await f.captcha.solveChallenge({ ...f.input, pointer: 'keyboard', keyboard, trajectory: challengeTrajectory })).token);
});

test('图片轨迹不能声称跨越尚未发生的服务端时间或使用非零时间基点', async t => {
  for (const trajectory of [challengeTrajectory.map(p => ({ ...p, t: p.t * 100 })), challengeTrajectory.map(p => ({ ...p, t: p.t + 1 }))]) {
    const f = await challengeFor(t);
    await assert.rejects(f.captcha.solveChallenge({ ...f.input, trajectory }), code('BEHAVIOR_REJECTED'));
  }
});

test('PNG 外圈的透明形状与隐藏 RGB 不再泄露方形边界的旋转角', () => {
  const size = 256, rgba = Buffer.alloc(size * size * 4, 255);
  const alpha = [];
  for (const angle of [0, 7, 31, 45, 90, 137, 180, 271, 359]) {
    const image = decodePng(rotatePuzzleToPng({ w: size, h: size, rgba }, angle));
    const mask = Buffer.alloc(size * size);
    for (let i = 0; i < mask.length; i++) {
      mask[i] = image.rgba[i * 4 + 3];
      if (!mask[i]) assert.deepEqual([...image.rgba.subarray(i * 4, i * 4 + 4)], [0, 0, 0, 0]);
    }
    alpha.push(mask);
  }
  for (const mask of alpha.slice(1)) assert.deepEqual(mask, alpha[0]);
  assert.equal(alpha[0][128 * size + 128], 255);
});

test('IPv6 等价写法和 IPv4 映射写法共享限流与令牌绑定', async t => {
  for (const variants of [
    ['2001:db8::1', '2001:0DB8:0000:0000:0000:0000:0000:0001', '2001:db8::1%eth0'],
    ['127.0.0.1', '::ffff:127.0.0.1', '0:0:0:0:0:FFFF:7f00:0001'],
  ]) {
    const f = fixture({ enabled: false, rateLimit: 1 }); t.after(() => f.close());
    const token = (await f.captcha.verifyBehavior({ ip: variants[0] })).token;
    for (const ip of variants) {
      assert.equal(validateContext({ ip }).ip, variants[0]);
      await assert.rejects(f.captcha.createPow({ ip }), code('RATE_LIMITED'));
    }
    assert.equal(await f.captcha.consumeToken({ ip: variants.at(-1), token }), true);
  }
  const req = { socket: { remoteAddress: '0:0:0:0:0:0:0:1' }, headers: { 'x-forwarded-for': '::FFFF:7f00:1' } };
  assert.equal(getClientIp(req, ['::1']), '127.0.0.1');
});

test('形似 IPv4 映射前缀的独立 IPv6 地址不能被错误合并', async t => {
  const f = fixture({ enabled: false }); t.after(() => f.close());
  const addresses = ['::ffff:0:7f00:1', '::ffff:0:7f00:2', '::ffff:0'];
  for (const ip of addresses) assert.equal(validateContext({ ip }).ip, ip);
  const { token } = await f.captcha.verifyBehavior({ ip: addresses[0] });
  assert.equal(await f.captcha.consumeToken({ ip: addresses[1], token }), false);
  assert.equal(await f.captcha.consumeToken({ ip: addresses[0], token }), true);
});

test('链路本地接口作用域不能合并或扩大可信代理范围', async t => {
  const f = fixture({ enabled: false }); t.after(() => f.close());
  const ip = 'fe80::1%eth0';
  assert.equal(validateContext({ ip: 'fe80:0:0:0:0:0:0:1%eth0' }).ip, ip);
  const { token } = await f.captcha.verifyBehavior({ ip });
  assert.equal(await f.captcha.consumeToken({ ip: 'fe80::1%eth1', token }), false);
  assert.equal(await f.captcha.consumeToken({ ip, token }), true);
  const req = { socket: { remoteAddress: 'fe80::1%eth1' }, headers: { 'x-forwarded-for': '127.0.0.1' } };
  assert.equal(getClientIp(req, ['fe80::1%eth0']), 'fe80::1%eth1');
  assert.equal(getClientIp(req, ['fe80::1%eth1']), '127.0.0.1');
});
