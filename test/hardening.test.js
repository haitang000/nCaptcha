import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveCaptchaOptions } from '../src/core.js';
import { createCaptcha } from '../src/index.js';
import { createHttpHandler } from '../src/http.js';
import { createFetchHandler } from '../src/fetch.js';
import { loadPuzzles, validatePrivatePuzzles, encodePng } from '../src/images.js';
import { configFromEnv } from '../src/server.js';
import { workerConfig } from '../workers/config.js';
import { fixture, ctx, verify, nonceFor, challengeTrajectory } from './helpers.js';

const code = expected => error => error.code === expected;
const binding = { sessionId: 'server-session-A', intentId: 'server-operation-A' };
const secret = 'hardening-server-secret-at-least-32-characters';
async function bound(f, extra = {}) {
  const input = { ...ctx, ...binding, ...extra };
  return { ...input, ...(await f.captcha.createIntent(input)) };
}

test('安全默认值限制单次答案；旧的多次重试仅由显式配置启用', async t => {
  assert.equal(resolveCaptchaOptions().challengeTries, 1);
  const f = fixture({ challengeTries: 1 }); t.after(() => f.close());
  const { challenge } = await verify(f.captcha);
  const input = { ...ctx, id: challenge.id, angle: -f.answer(challenge.id), trajectory: challengeTrajectory };
  await assert.rejects(f.captcha.solveChallenge({ ...input, angle: input.angle + 90 }), code('CHALLENGE_EXHAUSTED'));
  await assert.rejects(f.captcha.solveChallenge(input), code('CHALLENGE_EXPIRED'));
});

test('取消、答错和更换 action 不退还发题预算；窗口结束才恢复', async t => {
  const f = fixture({ challengeRateLimit: 2, rateWindowMs: 1000, challengeTries: 1 }); t.after(() => f.close());
  const first = (await verify(f.captcha)).challenge;
  await f.captcha.cancelChallenge({ ...ctx, id: first.id });
  const second = (await verify(f.captcha, { ...ctx, action: 'register' })).challenge;
  await assert.rejects(f.captcha.solveChallenge({ ...ctx, action: 'register', id: second.id, angle: -f.answer(second.id) + 90, trajectory: challengeTrajectory }), code('CHALLENGE_EXHAUSTED'));
  await assert.rejects(verify(f.captcha), code('CHALLENGE_RATE_LIMITED'));
  f.advance(1000);
  assert.ok((await verify(f.captcha)).challenge);
});

test('并发取题的发题预算原子执行', async t => {
  const f = fixture({ challengeRateLimit: 2, maxChallengesPerIp: 10 }); t.after(() => f.close());
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => verify(f.captcha)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
  assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason.code === 'CHALLENGE_RATE_LIMITED'));
});

test('强制意图时自报 sessionId/intentId 不能取代后端凭据；信誉查询仍可独立使用', async t => {
  const f = fixture({ requireIntent: true }); t.after(() => f.close());
  for (const method of ['createPow', 'verifyBehavior', 'solveChallenge', 'cancelChallenge', 'reportAgent']) {
    await assert.rejects(f.captcha[method]({ ...ctx, ...binding, enabled: false, mode: 'normal' }), code('INTENT_REQUIRED'));
  }
  assert.ok(await f.captcha.checkIpReputation(ctx));
  const input = await bound(f);
  for (const wrong of [{ intent: input.intent.slice(0, -1) + (input.intent.endsWith('0') ? '1' : '0') }, { ip: '127.0.0.2' }, { action: 'register' }]) {
    await assert.rejects(f.captcha.createPow({ ...input, ...wrong }), code('INTENT_INVALID'));
  }
  assert.ok((await f.captcha.createPow(input)).prefix);
});

test('同 IP 不同会话和操作不能交换凭据、取消题目、触发蜜罐或消费 Token', async t => {
  const f = fixture({ requireIntent: true }); t.after(() => f.close());
  const a = await bound(f), b = await bound(f, { sessionId: 'server-session-B' });
  const { challenge } = await verify(f.captcha, a);
  assert.equal(await f.captcha.cancelChallenge({ ...b, id: challenge.id }), false);
  await assert.rejects(f.captcha.reportAgent({ ...b, ticket: challenge.agent.ticket, source: 'fastpass' }), code('BINDING_MISMATCH'));
  const input = { id: challenge.id, angle: -f.answer(challenge.id), trajectory: challengeTrajectory };
  await assert.rejects(f.captcha.solveChallenge({ ...b, ...input }), code('BINDING_MISMATCH'));
  const { token } = await f.captcha.solveChallenge({ ...a, ...input });
  assert.equal(await f.captcha.consumeToken({ ...ctx, token }), false);
  assert.equal(await f.captcha.consumeToken({ ...b, token }), false);
  assert.equal(await f.captcha.consumeToken({ ...a, intentId: 'other-operation', token }), false);
  assert.equal(await f.captcha.consumeToken({ ...a, token }), true);
  assert.equal(await f.captcha.consumeToken({ ...a, token }), false);
  await assert.rejects(f.captcha.createPow(a), code('INTENT_INVALID'));
  await assert.rejects(f.captcha.createIntent(a), code('INTENT_INVALID'));
});

test('跨会话使用 PoW 不会烧掉原凭据，也不会延长其有效期', async t => {
  const f = fixture({ requireIntent: true }); t.after(() => f.close());
  const a = await bound(f), b = await bound(f, { sessionId: 'other-session' });
  const pow = await f.captcha.createPow(a), proof = { prefix: pow.prefix, nonce: nonceFor(pow) };
  await assert.rejects(f.captcha.verifyBehavior({ ...b, pow: proof }), code('POW_INVALID'));
  assert.ok((await f.captcha.verifyBehavior({ ...a, pow: proof })).challenge);
  const expiring = await f.captcha.createPow(a);
  f.advance(100000);
  await assert.rejects(f.captcha.verifyBehavior({ ...b, pow: { prefix: expiring.prefix, nonce: nonceFor(expiring) } }), code('POW_INVALID'));
  f.advance(20000);
  await assert.rejects(f.captcha.verifyBehavior({ ...a, pow: { prefix: expiring.prefix, nonce: nonceFor(expiring) } }), code('POW_INVALID'));
});

test('缺失或错误的意图凭据仍受真实 IP 请求限流', async t => {
  const f = fixture({ requireIntent: true, rateLimit: 2 }); t.after(() => f.close());
  await assert.rejects(f.captcha.createPow(ctx), code('INTENT_REQUIRED'));
  await assert.rejects(f.captcha.createPow({ ...ctx, intent: 'forged' }), code('INTENT_INVALID'));
  await assert.rejects(f.captcha.createPow(ctx), code('RATE_LIMITED'));
});

test('同一业务意图最多签发一个 Token，两个正确挑战并发也无法重复授权', async t => {
  const f = fixture({ requireIntent: true }); t.after(() => f.close());
  const input = await bound(f);
  const challenges = await Promise.all([verify(f.captcha, input), verify(f.captcha, input)]);
  const results = await Promise.allSettled(challenges.map(({ challenge }) => f.captcha.solveChallenge({ ...input, id: challenge.id, angle: -f.answer(challenge.id), trajectory: challengeTrajectory })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const { token } = results.find(result => result.status === 'fulfilled').value;
  const consumed = await Promise.all(Array.from({ length: 10 }, () => f.captcha.consumeToken({ ...input, token })));
  assert.equal(consumed.filter(Boolean).length, 1);
});

test('意图已签发 Token 后仍可上报蜜罐，并阻止尚未消费的 Token', async t => {
  const f = fixture({ requireIntent: true }); t.after(() => f.close());
  const input = await bound(f);
  const { challenge } = await verify(f.captcha, input);
  const { token } = await f.captcha.solveChallenge({ ...input, id: challenge.id, angle: -f.answer(challenge.id), trajectory: challengeTrajectory });
  await assert.rejects(f.captcha.reportAgent({ ...input, ticket: challenge.agent.ticket, source: 'fallback-api' }), code('BOT_DETECTED'));
  assert.equal(await f.captcha.consumeToken({ ...input, token }), false);
});

test('重复签发不延长意图期限；PoW、挑战和 Token 不超过意图有效期', async t => {
  const f = fixture({ requireIntent: true, intentTtlMs: 2000 }); t.after(() => f.close());
  const input = await bound(f);
  f.advance(1000);
  const repeated = await f.captcha.createIntent(input);
  assert.equal(repeated.intent, input.intent); assert.equal(repeated.expiresInMs, 1000);
  const pow = await f.captcha.createPow(input); assert.equal(pow.expiresInMs, 1000);
  const { challenge } = await f.captcha.verifyBehavior({ ...input, pow: { prefix: pow.prefix, nonce: nonceFor(pow) } });
  assert.equal(challenge.expiresInMs, 1000);
  const { token, expiresInMs } = await f.captcha.solveChallenge({ ...input, id: challenge.id, angle: -f.answer(challenge.id), trajectory: challengeTrajectory });
  assert.equal(expiresInMs, 1000);
  f.advance(1000);
  assert.equal(await f.captcha.consumeToken({ ...input, token }), false);
  await assert.rejects(f.captcha.createPow(input), code('INTENT_INVALID'));
  const stored = JSON.stringify([...f.records.values()]);
  assert.ok(!stored.includes(binding.sessionId)); assert.ok(!stored.includes(binding.intentId));
});

test('更换操作和 action 不会重置独立会话发题限额；其他会话仍可取题', async t => {
  const f = fixture({ requireIntent: true, sessionChallengeRateLimit: 1 }); t.after(() => f.close());
  const a = await bound(f);
  await f.captcha.cancelChallenge({ ...a, id: (await verify(f.captcha, a)).challenge.id });
  const another = await bound(f, { intentId: 'another-operation', action: 'register' });
  await assert.rejects(verify(f.captcha, another), code('CHALLENGE_RATE_LIMITED'));
  assert.ok((await verify(f.captcha, await bound(f, { sessionId: 'another-session' }))).challenge);
});

for (const adapter of ['http', 'fetch']) test(`${adapter} 意图签发需要后端密钥；公开请求不能伪造绑定；后端核验匹配会话`, async t => {
  const f = fixture({ requireIntent: true }); t.after(() => f.close());
  let send;
  if (adapter === 'fetch') {
    const handle = createFetchHandler(f.captcha, { secret, getIp: () => ctx.ip, allowedOrigins: ['https://app.example'] });
    send = (route, body, headers = {}) => handle(new Request('https://captcha.example/captcha/v1' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }));
  } else {
    const handle = createHttpHandler(f.captcha, { secret, allowedOrigins: ['https://app.example'] });
    const server = http.createServer((req, res) => { void handle(req, res); });
    server.listen(0, ctx.ip); await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    send = (route, body, headers = {}) => fetch(`http://${ctx.ip}:${server.address().port}/captcha/v1` + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  }
  const auth = { Authorization: `Bearer ${secret}` };
  assert.equal((await send('/intent', { ...ctx, ...binding })).status, 401);
  assert.equal((await send('/intent', { ...ctx, ...binding }, { ...auth, Origin: 'https://app.example' })).status, 403);
  const { intent } = await (await send('/intent', { ...ctx, ...binding }, auth)).json();
  assert.equal((await send('/pow', { ...binding, action: ctx.action })).status, 403);
  const pow = await (await send('/pow', { intent, action: ctx.action })).json();
  const { challenge } = await (await send('/verify', { intent, action: ctx.action, pow: { prefix: pow.prefix, nonce: nonceFor(pow) } })).json();
  const { token } = await (await send('/challenge', { intent, action: ctx.action, id: challenge.id, angle: -f.answer(challenge.id), trajectory: challengeTrajectory })).json();
  assert.ok(token);
  assert.deepEqual(await (await send('/siteverify', { ...ctx, ...binding, sessionId: 'wrong', token }, auth)).json(), { success: false });
  assert.deepEqual(await (await send('/siteverify', { ...ctx, ...binding, token }, auth)).json(), { success: true });
});

test('私有题库拒绝演示图片及重复图片，并在 Node 启动时强制检查', async t => {
  const bundled = loadPuzzles(new URL('../assets/puzzles/', import.meta.url));
  assert.throws(() => validatePrivatePuzzles(bundled, bundled), /内置/);
  const pic = { w: 24, h: 24, rgba: Buffer.alloc(24 * 24 * 4, 255) };
  assert.throws(() => validatePrivatePuzzles(Array(32).fill(pic), bundled), /当前仅 1 张/);
  assert.throws(() => createCaptcha({ requirePrivateImages: true }), /imagesDir/);
  assert.throws(() => createCaptcha({ requirePrivateImages: true, imagesDir: new URL('../assets/puzzles/', import.meta.url) }), /内置/);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'captcha-private-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'private.png'), encodePng(pic));
  assert.throws(() => createCaptcha({ requirePrivateImages: true, imagesDir: directory }), /32 张/);
  const captcha = createCaptcha({ requirePrivateImages: true, minPrivateImages: 1, imagesDir: directory });
  await captcha.close();
});

test('Node 与 Workers 校验新增配置，Node 生产环境默认要求绑定和私有题库', () => {
  const env = { CAPTCHA_SECRET: secret, CAPTCHA_REQUIRE_INTENT: 'true', CAPTCHA_REQUIRE_PRIVATE_IMAGES: 'true', CAPTCHA_INTENT_TTL_MS: '12345', CAPTCHA_CHALLENGE_RATE_LIMIT: '8', CAPTCHA_SESSION_CHALLENGE_RATE_LIMIT: '3', CAPTCHA_MIN_PRIVATE_IMAGES: '40' };
  for (const parse of [configFromEnv, workerConfig]) {
    const { options } = parse(env);
    assert.equal(options.requireIntent, true); assert.equal(options.requirePrivateImages, true);
    assert.equal(options.intentTtlMs, 12345); assert.equal(options.challengeRateLimit, 8); assert.equal(options.sessionChallengeRateLimit, 3); assert.equal(options.minPrivateImages, 40);
    assert.throws(() => parse({ ...env, CAPTCHA_REQUIRE_INTENT: 'yes' }), TypeError);
  }
  const { options } = configFromEnv({ CAPTCHA_SECRET: secret, NODE_ENV: 'production' });
  assert.equal(options.requireIntent, true); assert.equal(options.requirePrivateImages, true);
  for (const options of [{ requireIntent: 'true' }, { intentTtlMs: 0 }, { challengeRateLimit: 0 }, { sessionChallengeRateLimit: NaN }, { requirePrivateImages: 1 }, { minPrivateImages: 0 }]) assert.throws(() => resolveCaptchaOptions(options), TypeError);
});
