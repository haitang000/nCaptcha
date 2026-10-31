import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, ctx, verify, challengeTrajectory } from './helpers.js';

const code = expected => error => error.code === expected;
const uniform = Array.from({ length: 8 }, (_, i) => ({ x: 100 + i * 10, y: 200, t: i * 30 }));

async function challengeFor(t, options) {
  const f = fixture(options); t.after(() => f.close());
  const { challenge } = await verify(f.captcha);
  return { ...f, input: { ...ctx, id: challenge.id, angle: -f.answer(challenge.id) } };
}

test('图片角度正确仍拒绝缺失、静止、过快和机械匀速鼠标轨迹', async t => {
  const invalid = [undefined, null, [], [{ x: 1, y: 1, t: 0 }, { x: 2, y: 1, t: 100 }],
    challengeTrajectory.map(p => ({ ...p, x: 100, y: 200 })),
    challengeTrajectory.map(p => ({ ...p, t: p.t / 10 })), uniform,
    [{ ...uniform[0], t: 0 }, ...uniform.map(p => ({ ...p, t: p.t + 20 })), { ...uniform.at(-1), t: 400 }]];
  for (const [i, trajectory] of invalid.entries()) await t.test(String(i), async t => {
    const f = await challengeFor(t);
    // 空数组是格式错误；缺失或合理格式的低质量轨迹是行为拒绝。
    await assert.rejects(f.captcha.solveChallenge({ ...f.input, trajectory }), code(Array.isArray(trajectory) && !trajectory.length ? 'INVALID_INPUT' : 'BEHAVIOR_REJECTED'));
    assert.ok((await f.captcha.solveChallenge({ ...f.input, trajectory: challengeTrajectory })).token);
  });
});

test('图片轨迹格式、点数、时间和屏幕范围均在服务端校验', async t => {
  const hints = { dpr: 1, sw: 1000, sh: 800, tz: 0, lang: ['zh-CN'], pointer: 'mouse' };
  for (const trajectory of [false, [{ x: 0, y: 0, t: 0 }],
    challengeTrajectory.map(p => ({ ...p, t: 0 })), challengeTrajectory.map(p => ({ ...p, x: Infinity })),
    challengeTrajectory.map(p => ({ ...p, y: 4000 })), Array.from({ length: 151 }, (_, i) => ({ x: i, y: 0, t: i * 20 }))]) {
    const f = await challengeFor(t);
    await assert.rejects(f.captcha.solveChallenge({ ...f.input, trajectory, hints }), code('INVALID_INPUT'));
    assert.ok((await f.captcha.solveChallenge({ ...f.input, trajectory: challengeTrajectory, hints })).token);
  }
});

test('图片轨迹支持直线、短距离微调、固定刷新率、触屏、笔和纯键盘', async t => {
  const short = [{ x: 100, y: 200, t: 0 }, { x: 101, y: 200, t: 45 }, { x: 102, y: 200, t: 130 }];
  for (const [pointer, trajectory] of [['mouse', challengeTrajectory], ['mouse', short],
    ['mouse', challengeTrajectory.map((p, i) => ({ ...p, t: i * 30 }))], ['touch', uniform], ['pen', uniform], ['keyboard', null]]) {
    const f = await challengeFor(t);
    assert.ok((await f.captcha.solveChallenge({ ...f.input, pointer, trajectory })).token);
  }
});

test('轨迹拒绝原子扣减尝试次数、释放挑战并提高后续 PoW 难度', async t => {
  const f = await challengeFor(t, { maxChallengesPerIp: 1 });
  for (let i = 0; i < 3; i++) {
    await assert.rejects(f.captcha.solveChallenge(f.input), error => {
      assert.equal(error.code, i === 2 ? 'CHALLENGE_EXHAUSTED' : 'BEHAVIOR_REJECTED');
      assert.equal(error.details.triesRemaining, 2 - i); return true;
    });
  }
  assert.equal((await f.captcha.createPow(ctx)).bits, 5);
  await assert.rejects(f.captcha.solveChallenge({ ...f.input, trajectory: challengeTrajectory }), code('CHALLENGE_EXPIRED'));
  assert.ok((await verify(f.captcha)).challenge);
});
