import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, ctx, nonceFor, verify, challengeTrajectory } from './helpers.js';
const code = expected => error => error.code === expected;

test('绑定不符的请求只拒绝本次调用，不消耗也不销毁原上下文凭据', async t => {
  await t.test('PoW 凭证', async () => {
    const f = fixture();
    try {
      const pow = await f.captcha.createPow(ctx);
      const proof = { prefix: pow.prefix, nonce: nonceFor(pow) };
      await assert.rejects(f.captcha.verifyBehavior({ ...ctx, ip: '127.0.0.2', pow: proof }), code('POW_INVALID'));
      await assert.rejects(f.captcha.verifyBehavior({ ...ctx, action: 'register', pow: proof }), code('POW_INVALID'));
      const { challenge } = await f.captcha.verifyBehavior({ ...ctx, pow: proof });
      assert.match(challenge.id, /^[a-f0-9]{32}$/);
    } finally { await f.close(); }
  });
  await t.test('图片挑战', async () => {
    const f = fixture();
    try {
      const { challenge } = await verify(f.captcha);
      const input = { ...ctx, id: challenge.id, angle: -f.answer(challenge.id), trajectory: challengeTrajectory };
      await assert.rejects(f.captcha.solveChallenge({ ...input, ip: '127.0.0.2' }), code('BINDING_MISMATCH'));
      await assert.rejects(f.captcha.solveChallenge({ ...input, action: 'register' }), code('BINDING_MISMATCH'));
      const result = await f.captcha.solveChallenge(input);
      assert.match(result.token, /^[a-f0-9]{64}$/);
    } finally { await f.close(); }
  });
});
