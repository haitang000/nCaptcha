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

test('ABCD 每轮随机票据和假令牌，四个来源均标记所属轮次并拒绝重放', async t => {
  const f = fixture(); t.after(() => f.close());
  const tickets = new Set(), tokens = new Set();
  for (const source of ['fastpass', 'compat-event', 'canary-token', 'fallback-api']) {
    const pow = await f.captcha.createPow(ctx);
    assert.match(pow.agent.ticket, /^[a-f0-9]{32}$/); assert.match(pow.agent.token, /^[a-f0-9]{64}$/);
    tickets.add(pow.agent.ticket); tokens.add(pow.agent.token);
    await assert.rejects(f.captcha.reportAgent({ ...ctx, ...pow.agent, source }), error => detected(error) && error.details.source === source);
    await assert.rejects(f.captcha.verifyBehavior({ ...ctx, pow: { prefix: pow.prefix, nonce: nonceFor(pow) } }), detected);
    assert.equal(await f.captcha.consumeToken({ ...ctx, token: pow.agent.token }), false);
  }
  assert.equal(tickets.size, 4); assert.equal(tokens.size, 4);
});

test('备用接口校验票据、来源、IP 和 action；伪造请求不会损坏正常轮次', async t => {
  const f = fixture(); t.after(() => f.close());
  const pow = await f.captcha.createPow(ctx);
  const input = { ...ctx, ticket: pow.agent.ticket, source: 'fallback-api' };
  for (const bad of [{ ticket: 'bad' }, { source: 'unknown' }, { source: 'canary-token', token: 'a'.repeat(64) }]) {
    await assert.rejects(f.captcha.reportAgent({ ...input, ...bad }), error => error.code === 'INVALID_INPUT');
  }
  await assert.rejects(f.captcha.reportAgent({ ...input, ticket: '0'.repeat(32) }), error => error.code === 'AGENT_TICKET_INVALID');
  for (const wrong of [{ ip: '127.0.0.2' }, { action: 'other' }]) {
    await assert.rejects(f.captcha.reportAgent({ ...input, ...wrong }), error => error.code === 'BINDING_MISMATCH');
    assert.equal(await f.captcha.consumeToken({ ...ctx, ...wrong, token: pow.agent.token }), false);
  }
  assert.ok((await f.captcha.verifyBehavior({ ...ctx, pow: { prefix: pow.prefix, nonce: nonceFor(pow) } })).challenge);
});

test('命中备用接口释放当前图片名额，同 IP 另一轮挑战可正常通过', async t => {
  const f = fixture({ maxChallengesPerIp: 2 }); t.after(() => f.close());
  const first = (await verify(f.captcha)).challenge, second = (await verify(f.captcha)).challenge;
  await assert.rejects(f.captcha.reportAgent({ ...ctx, ticket: first.agent.ticket, source: 'fallback-api' }), detected);
  await assert.rejects(f.captcha.solveChallenge({ ...ctx, id: first.id, angle: -f.answer(first.id), trajectory: challengeTrajectory }), detected);
  assert.ok((await f.captcha.solveChallenge({ ...ctx, id: second.id, angle: -f.answer(second.id), trajectory: challengeTrajectory })).token);
  assert.ok((await verify(f.captcha)).challenge);
});

test('业务核验收到假令牌时标记其轮次，已签发的同轮真令牌也不能再消费', async t => {
  const f = fixture(); t.after(() => f.close());
  const { challenge } = await verify(f.captcha);
  const result = await f.captcha.solveChallenge({ ...ctx, id: challenge.id, angle: -f.answer(challenge.id), trajectory: challengeTrajectory });
  assert.notEqual(result.token, challenge.agent.token);
  assert.equal(await f.captcha.consumeToken({ ...ctx, token: challenge.agent.token }), false);
  assert.equal(await f.captcha.consumeToken({ ...ctx, token: result.token }), false);
  await assert.rejects(f.captcha.reportAgent({ ...ctx, ticket: challenge.agent.ticket, source: 'fallback-api' }), error => detected(error) && error.details.source === 'canary-token');
  const independent = await solved(f);
  assert.equal(await f.captcha.consumeToken({ ...ctx, token: independent.token }), true);
});

test('PoW、图片、令牌阶段延长所属票据有效期，最终到期后拒绝上报', async t => {
  const f = fixture({ powTtlMs: 10, challengeTtlMs: 40, tokenTtlMs: 50 }); t.after(() => f.close());
  const pow = await f.captcha.createPow(ctx); f.advance(8);
  const { challenge } = await f.captcha.verifyBehavior({ ...ctx, pow: { prefix: pow.prefix, nonce: nonceFor(pow) } });
  f.advance(20);
  const result = await f.captcha.solveChallenge({ ...ctx, id: challenge.id, angle: -f.answer(challenge.id), trajectory: challengeTrajectory });
  f.advance(20);
  assert.equal(result.agent.ticket, pow.agent.ticket); assert.equal(result.agent.expiresInMs, 50);
  assert.equal(await f.captcha.consumeToken({ ...ctx, token: pow.agent.token }), false);
  assert.equal(await f.captcha.consumeToken({ ...ctx, token: result.token }), false);
  f.advance(30);
  await assert.rejects(f.captcha.reportAgent({ ...ctx, ticket: pow.agent.ticket, source: 'fastpass' }), error => error.code === 'AGENT_TICKET_INVALID');
  assert.equal(await f.captcha.consumeToken({ ...ctx, token: pow.agent.token }), false);
});

test('并发重复上报只计罚一次且不延长票据寿命', async t => {
  const f = fixture({ powTtlMs: 100 }); t.after(() => f.close());
  const pow = await f.captcha.createPow(ctx);
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => f.captcha.reportAgent({ ...ctx, ticket: pow.agent.ticket, source: 'fastpass' })));
  assert.ok(results.every(result => result.status === 'rejected' && detected(result.reason)));
  assert.equal((await f.captcha.createPow(ctx)).bits, 3);
  f.advance(100);
  await assert.rejects(f.captcha.reportAgent({ ...ctx, ticket: pow.agent.ticket, source: 'fastpass' }), error => error.code === 'AGENT_TICKET_INVALID');
});
