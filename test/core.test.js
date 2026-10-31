import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCaptcha, createMemoryStore } from '../src/index.js';
import { fixture, ctx, nonceFor, verify, solved, challengeTrajectory } from './helpers.js';
const code = expected => error => error.code === expected;

test('默认参数、无题图及非法配置在启动时失败', async () => {
  for (const options of [{ powBits: NaN }, { powBits: 29 }, { tolerance: 0 }, { mode: 'x' }, { minTokenAgeMs: 300000 }, { enabled: 'false' }]) assert.throws(() => createCaptcha(options), TypeError);
  assert.throws(() => createCaptcha({ imagesDir: './not-present' }), /题图/);
  const f = fixture({ powBits: 20 });
  try { assert.equal((await f.captcha.createPow(ctx)).bits, 20); } finally { await f.close(); }
});
test('PoW 正确、错误、重放、过期及 IP/用途绑定', async t => {
  for (const kind of ['wrong', 'replay', 'expired', 'ip', 'action']) await t.test(kind, async () => {
    const f = fixture();
    try {
      const pow = await f.captcha.createPow(ctx);
      const input = { ...ctx, pow: { prefix: pow.prefix, nonce: nonceFor(pow, kind !== 'wrong') } };
      if (kind === 'replay') await f.captcha.verifyBehavior(input);
      if (kind === 'expired') f.advance(120000);
      if (kind === 'ip') input.ip = '127.0.0.2';
      if (kind === 'action') input.action = 'register';
      await assert.rejects(f.captcha.verifyBehavior(input), code('POW_INVALID'));
      await assert.rejects(f.captcha.verifyBehavior({ ...ctx, pow: input.pow }), code('POW_INVALID'));
    } finally { await f.close(); }
  });
});
test('普通模式接受高分行为，弱/缺失信号和严格模式出图片', async () => {
  const f = fixture({ mode: 'normal' });
  const formBehavior = { totalMs: 5000, focusOrder: ['a', 'b'], fields: { a: { n: 6, meanGap: 100, varGap: 200 }, b: { n: 6, meanGap: 120, varGap: 250 } } };
  try {
    assert.ok((await verify(f.captcha, ctx, { formBehavior })).token);
    assert.ok((await verify(f.captcha)).challenge);
    f.captcha.setMode('strict');
    assert.ok((await verify(f.captcha, ctx, { formBehavior })).challenge);
    assert.throws(() => f.captcha.setMode('invalid'), code('INVALID_INPUT'));
  } finally { await f.close(); }
});
test('非法行为数据返回稳定错误；失败声誉会增加难度且会过期', async () => {
  const f = fixture();
  try {
    for (const signals of [{ hints: false }, { trajectory: [{ x: 0, y: 0, t: 0 }] }, { formBehavior: { totalMs: 5, fields: { bad: null }, focusOrder: [] } }]) await assert.rejects(verify(f.captcha, ctx, signals), code('INVALID_INPUT'));
    assert.equal((await f.captcha.createPow(ctx)).bits, 5);
    f.advance(600000);
    assert.equal((await f.captcha.createPow(ctx)).bits, 3);
    await assert.rejects(f.captcha.createPow({ ip: 'spoof' }), code('INVALID_INPUT'));
    await assert.rejects(f.captcha.createPow({ ...ctx, action: '../../x' }), code('INVALID_INPUT'));
  } finally { await f.close(); }
});
test('图片答案方向、跨 0° 容差、触屏容差和错误角度', async t => {
  for (const [pointer, offset, pass] of [['mouse', 10, true], ['mouse', 12, false], ['touch', 14, true], ['pen', 14, true], ['touch', 16, false]]) await t.test(pointer + offset, async () => {
    const f = fixture();
    try {
      const { challenge } = await verify(f.captcha);
      const request = f.captcha.solveChallenge({ ...ctx, id: challenge.id, angle: 360 - f.answer(challenge.id) + offset, pointer, trajectory: challengeTrajectory });
      if (pass) assert.ok((await request).token); else await assert.rejects(request, code('ANGLE_INCORRECT'));
    } finally { await f.close(); }
  });
});
test('最低求解时间保留挑战；三次错误耗尽；取消只释放自己的挑战', async () => {
  const f = fixture({ minSolveMs: 1000 });
  try {
    const a = (await verify(f.captcha)).challenge, b = (await verify(f.captcha)).challenge, c = (await verify(f.captcha)).challenge;
    await assert.rejects(verify(f.captcha), code('CHALLENGE_LIMIT'));
    await assert.rejects(f.captcha.solveChallenge({ ...ctx, id: b.id, angle: -f.answer(b.id) }), code('TOO_FAST'));
    assert.equal(await f.captcha.cancelChallenge({ ...ctx, action: 'other', id: a.id }), false);
    assert.equal(await f.captcha.cancelChallenge({ ...ctx, id: a.id }), true);
    assert.ok((await verify(f.captcha)).challenge);
    f.advance(1000);
    assert.ok((await f.captcha.solveChallenge({ ...ctx, id: b.id, angle: -f.answer(b.id), trajectory: challengeTrajectory })).token);
    for (let i = 0; i < 3; i++) await assert.rejects(f.captcha.solveChallenge({ ...ctx, id: c.id, angle: -f.answer(c.id) + 90, trajectory: challengeTrajectory }), code(i === 2 ? 'CHALLENGE_EXHAUSTED' : 'ANGLE_INCORRECT'));
    await assert.rejects(f.captcha.solveChallenge({ ...ctx, id: c.id, angle: -f.answer(c.id) }), code('CHALLENGE_EXPIRED'));
  } finally { await f.close(); }
});
test('挑战过期、跨用途/跨 IP、并发求解仅成功一次', async t => {
  for (const kind of ['expiry', 'ip', 'action', 'race']) await t.test(kind, async () => {
    const f = fixture();
    try {
      const { challenge } = await verify(f.captcha);
      const input = { ...ctx, id: challenge.id, angle: -f.answer(challenge.id), trajectory: challengeTrajectory };
      if (kind === 'race') {
        const results = await Promise.allSettled(Array.from({ length: 10 }, () => f.captcha.solveChallenge(input)));
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); return;
      }
      if (kind === 'expiry') f.advance(300000);
      if (kind === 'ip') input.ip = '127.0.0.2';
      if (kind === 'action') input.action = 'other';
      await assert.rejects(f.captcha.solveChallenge(input), code(kind === 'expiry' ? 'CHALLENGE_EXPIRED' : 'BINDING_MISMATCH'));
    } finally { await f.close(); }
  });
});
test('令牌等待、有效期、重放、IP/用途绑定与并发消费', async () => {
  const f = fixture({ minTokenAgeMs: 300 });
  try {
    const result = await solved(f);
    assert.equal(result.usableAfterMs, 300); assert.equal(result.expiresInMs, 300000);
    assert.equal(await f.captcha.consumeToken({ ...ctx, token: result.token }), false);
    f.advance(300);
    const consumed = await Promise.all(Array.from({ length: 20 }, () => f.captcha.consumeToken({ ...ctx, token: result.token })));
    assert.equal(consumed.filter(Boolean).length, 1);
    for (const wrong of [{ ip: '127.0.0.2' }, { action: 'other' }]) {
      const token = (await solved(f)).token; f.advance(300);
      assert.equal(await f.captcha.consumeToken({ ...ctx, ...wrong, token }), false);
      assert.equal(await f.captcha.consumeToken({ ...ctx, token }), true);
      assert.equal(await f.captcha.consumeToken({ ...ctx, token }), false);
    }
    const token = (await solved(f)).token; f.advance(300000);
    assert.equal(await f.captcha.consumeToken({ ...ctx, token }), false);
  } finally { await f.close(); }
});
test('同 IP 挑战数量上限原子执行；限流恢复；实例和存储生命周期隔离', async () => {
  const f = fixture();
  try {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => verify(f.captcha)));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 3);
    const other = createCaptcha({ enabled: false });
    const result = await other.verifyBehavior(ctx);
    assert.equal(await f.captcha.consumeToken({ ...ctx, token: result.token }), false);
    await other.close(); await assert.rejects(other.createPow(ctx), code('CLOSED'));
  } finally { await f.close(); }
  const limited = fixture({ rateLimit: 2, rateWindowMs: 1000 });
  try { await limited.captcha.createPow(ctx); await limited.captcha.createPow(ctx); await assert.rejects(limited.captcha.createPow(ctx), code('RATE_LIMITED')); limited.advance(1000); await limited.captcha.createPow(ctx); } finally { await limited.close(); }
});
test('内存存储 TTL、拷贝隔离、容量与同步原子回调约束', async () => {
  let time = 0;
  const store = createMemoryStore({ now: () => time, cleanupIntervalMs: 0, maxEntries: 1 });
  await store.set('a', { n: 1 }, 10);
  const a = await store.get('a'); a.n = 9; assert.equal((await store.get('a')).n, 1);
  await assert.rejects(store.set('b', 1, 10), code('STORE_FULL'));
  await assert.rejects(store.update('a', async () => ({ value: 1, ttlMs: 10 })), TypeError);
  time = 10; assert.equal(await store.get('a'), undefined);
  await store.set('b', 1, 10); await store.close(); await assert.rejects(store.get('b'), code('CLOSED'));
});
