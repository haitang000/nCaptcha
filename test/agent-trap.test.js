import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, ctx, nonceFor, verify, solved, challengeTrajectory } from './helpers.js';

const detected = error => error.code === 'BOT_DETECTED' && error.status === 403 && error.details.bot === true;

test('agent 蜜罐拒绝签发并消费 PoW；清空标记不能重放，同 IP 其他验证仍可通过', async t => {
  const f = fixture(); t.after(() => f.close());
  const pow = await f.captcha.createPow(ctx);
  const input = { ...ctx, pow: { prefix: pow.prefix, nonce: nonceFor(pow) } };
  await assert.rejects(f.captcha.verifyBehavior({ ...input, agentSignal: 'automated-agent' }), detected);
  await assert.rejects(f.captcha.verifyBehavior(input), error => error.code === 'POW_INVALID');
  assert.ok((await solved(f)).token);
  assert.ok((await verify(f.captcha, ctx, { agentSignal: '' })).challenge);
});

test('图片挑战阶段命中蜜罐会销毁挑战并释放名额，答案正确或提交过快都不能通过', async t => {
  const f = fixture({ maxChallengesPerIp: 1, minSolveMs: 1000 }); t.after(() => f.close());
  const { challenge } = await verify(f.captcha);
  const input = { ...ctx, id: challenge.id, angle: -f.answer(challenge.id), trajectory: challengeTrajectory };
  await assert.rejects(f.captcha.solveChallenge({ ...input, agentSignal: 'automated-agent' }), detected);
  await assert.rejects(f.captcha.solveChallenge(input), error => error.code === 'CHALLENGE_EXPIRED');
  assert.ok((await verify(f.captcha)).challenge);
});

test('任何非空蜜罐值均拒绝，格式不正确不能被当作未命中', async t => {
  const f = fixture(); t.after(() => f.close());
  for (const agentSignal of ['agent', ' ']) await assert.rejects(verify(f.captcha, ctx, { agentSignal }), detected);
  for (const agentSignal of [null, false, 0, {}, [], 'a'.repeat(65)]) {
    await assert.rejects(f.captcha.verifyBehavior({ ...ctx, agentSignal }), error => error.code === 'INVALID_INPUT');
    await assert.rejects(f.captcha.solveChallenge({ ...ctx, agentSignal }), error => error.code === 'INVALID_INPUT');
  }
});

test('已申报为 agent 时即使关闭图片验证也不签发令牌', async t => {
  const f = fixture({ enabled: false }); t.after(() => f.close());
  await assert.rejects(f.captcha.verifyBehavior({ ...ctx, agentSignal: 'automated-agent' }), detected);
  assert.ok((await f.captcha.verifyBehavior({ ...ctx, agentSignal: '' })).token);
});
