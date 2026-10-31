import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, nonceFor, challengeTrajectory } from './helpers.js';
import { configFromEnv } from '../src/server.js';
import { workerConfig } from '../workers/config.js';

const context = { ip: '8.8.8.8', action: 'login' };
const secret = 'ipqs-config-test-secret-at-least-32-characters';
const apiKey = 'private-ipqs-test-key';
const response = (score = 10, extra = {}) => Response.json({ success: true, fraud_score: score, proxy: false, vpn: false, tor: false, recent_abuse: false, bot_status: false, ...extra });
const code = expected => error => error.code === expected;

test('IPQS 服务端配置在 Node 和 Workers 中一致，缺失 Key 不会静默启用', () => {
  for (const parse of [configFromEnv, workerConfig]) {
    assert.equal(parse({ CAPTCHA_SECRET: secret, IPQS_API_KEY: '' }).options.ipqs, undefined);
    const config = parse({ CAPTCHA_SECRET: secret, IPQS_API_KEY: apiKey, CAPTCHA_IPQS_TIMEOUT_MS: '1500', CAPTCHA_IPQS_BLOCK_SCORE: '90' });
    assert.equal(config.options.ipqs.apiKey, apiKey);
    assert.equal(config.options.ipqs.timeoutMs, 1500);
    assert.equal(config.options.ipqs.blockScore, 90);
    for (const extra of [{ CAPTCHA_IPQS_BLOCK_SCORE: '90' }, { IPQS_API_KEY: ' ' }, { IPQS_API_KEY: apiKey, CAPTCHA_IPQS_TIMEOUT_MS: '0' },
      { IPQS_API_KEY: apiKey, CAPTCHA_IPQS_CACHE_TTL_MS: 'NaN' }, { IPQS_API_KEY: apiKey, CAPTCHA_IPQS_STRICTNESS: '4' }, { IPQS_API_KEY: apiKey, CAPTCHA_IPQS_BLOCK_SCORE: '101' }]) {
      assert.throws(() => parse({ CAPTCHA_SECRET: secret, ...extra }), TypeError);
    }
  }
  for (const ipqs of [null, [], {}, { apiKey, fetch: false }, { apiKey, blockScore: -1 }]) assert.throws(() => fixture({ ipqs }), TypeError);
});

test('查询显式传访客 IP，缓存与并发合并不泄露 Key，规范化 IPv6 共享缓存', async t => {
  const calls = [];
  const f = fixture({ ipqs: { apiKey, cacheTtlMs: 1000, fetch: async (url, init) => {
    calls.push({ url, init });
    return response(12, { vpn: true, proxy: true });
  } } }); t.after(() => f.close());
  const results = await Promise.all(Array.from({ length: 12 }, () => f.captcha.checkIpReputation(context)));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.hostname, 'ipqualityscore.com');
  assert.equal(calls[0].url.pathname, `/api/json/ip/${apiKey}/8.8.8.8`);
  assert.equal(calls[0].url.searchParams.get('strictness'), '0');
  assert.equal(calls[0].url.searchParams.get('allow_public_access_points'), 'true');
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(results[0].fraudScore, 12); assert.equal(results[0].risk, 'low'); assert.equal(results[0].vpn, true);
  results[0].fraudScore = 100;
  assert.equal(results[1].fraudScore, 12);
  assert.equal((await f.captcha.checkIpReputation(context)).fraudScore, 12);
  assert.ok(!JSON.stringify([...f.records]).includes(apiKey));
  f.advance(1000);
  await f.captcha.checkIpReputation(context);
  assert.equal(calls.length, 2);
  const variants = ['2001:4860:4860::8888', '2001:4860:4860:0000:0000:0000:0000:8888'];
  for (const ip of variants) assert.equal((await f.captcha.checkIpReputation({ ip })).ip, variants[0]);
  assert.equal(calls.length, 3);
  assert.equal(decodeURIComponent(calls[2].url.pathname.split('/').at(-1)), variants[0]);
});

test('显式关闭时明确 disabled；内网、回环、保留地址明确 skipped，不会当作 0 分', async t => {
  const disabled = fixture({ reputationProvider: 'off' }); t.after(() => disabled.close());
  assert.equal((await disabled.captcha.checkIpReputation(context)).status, 'disabled');
  let calls = 0;
  const f = fixture({ ipqs: { apiKey, fetch: async () => { calls++; return response(); } } }); t.after(() => f.close());
  for (const ip of ['127.0.0.1', '::ffff:127.0.0.1', '10.0.0.1', '100.64.0.1', '169.254.1.1', '172.16.0.1', '192.168.1.1', '192.0.2.1', '198.51.100.2', '203.0.113.1', '240.0.0.1', '::1', 'fd00::1', 'fe80::1%eth0', '2001:db8::1', '3fff::1']) {
    const result = await f.captcha.checkIpReputation({ ip });
    assert.equal(result.status, 'skipped', ip); assert.equal(result.fraudScore, null); assert.equal(result.risk, 'unknown');
  }
  assert.equal(calls, 0);
});

test('风险分增加 PoW，代理标记本身不拦截，也不跳过图片和行为检查', async t => {
  for (const [score, extraBits] of [[0, 0], [74, 0], [75, 2], [89, 2], [90, 4], [100, 4]]) {
    let calls = 0;
    const f = fixture({ ipqs: { apiKey, fetch: async () => { calls++; return response(score, { vpn: true }); } } }); t.after(() => f.close());
    const pow = await f.captcha.createPow(context);
    assert.equal(pow.bits, 3 + extraBits);
    assert.ok(!JSON.stringify(pow).includes('fraudScore'));
    const { challenge, token } = await f.captcha.verifyBehavior({ ...context, pow: { prefix: pow.prefix, nonce: nonceFor(pow) }, fraudScore: 0 });
    assert.ok(challenge); assert.equal(token, undefined);
    await assert.rejects(f.captcha.solveChallenge({ ...context, id: challenge.id, angle: -f.answer(challenge.id) }), code('BEHAVIOR_REJECTED'));
    assert.ok((await f.captcha.solveChallenge({ ...context, id: challenge.id, angle: -f.answer(challenge.id), trajectory: challengeTrajectory })).token);
    assert.equal(calls, 1);
  }
  const capped = fixture({ powBits: 27, ipqs: { apiKey, fetch: async () => response(99) } }); t.after(() => capped.close());
  assert.equal((await capped.captcha.createPow(context)).bits, 28);
});

test('可配置拦截阈值在 PoW、换取挑战和签发令牌前执行，客户端不能覆盖', async t => {
  let score = 90;
  const f = fixture({ ipqs: { apiKey, cacheTtlMs: 1, blockScore: 90, fetch: async () => response(score) } }); t.after(() => f.close());
  await assert.rejects(f.captcha.createPow({ ...context, fraudScore: 0 }), code('IP_REPUTATION_BLOCKED'));
  score = 10; f.advance(1);
  let pow = await f.captcha.createPow(context);
  score = 90; f.advance(1);
  await assert.rejects(f.captcha.verifyBehavior({ ...context, pow: { prefix: pow.prefix, nonce: nonceFor(pow) } }), code('IP_REPUTATION_BLOCKED'));
  score = 10; f.advance(1);
  pow = await f.captcha.createPow(context);
  const { challenge } = await f.captcha.verifyBehavior({ ...context, pow: { prefix: pow.prefix, nonce: nonceFor(pow) } });
  score = 90; f.advance(1);
  await assert.rejects(f.captcha.solveChallenge({ ...context, id: challenge.id, angle: -f.answer(challenge.id), trajectory: challengeTrajectory }), code('IP_REPUTATION_BLOCKED'));
  assert.equal([...f.records.keys()].filter(key => key.includes(':token:')).length, 0);
});

test('HTTP 错误、额度不足和畸形响应保持 unknown，错误不暴露 Key', async t => {
  const cases = [
    [() => new Response('', { status: 302, headers: { Location: 'https://other.example' } }), 'http_error'],
    [() => new Response('', { status: 429 }), 'http_error'],
    [() => Response.json({ success: false, message: apiKey }), 'provider_error'],
    [() => new Response('{'), 'invalid_response'],
    ...[null, '0', -1, 101].map(score => [() => response(score), 'invalid_response']),
    [() => Response.json({ fraud_score: 0 }), 'invalid_response'],
    [() => { throw new Error(apiKey); }, 'network_error'],
  ];
  for (const [makeResponse, reason] of cases) {
    const f = fixture({ ipqs: { apiKey, blockScore: 90, fetch: async () => makeResponse() } }); t.after(() => f.close());
    const result = await f.captcha.checkIpReputation(context);
    assert.equal(result.status, 'unavailable'); assert.equal(result.risk, 'unknown'); assert.equal(result.fraudScore, null); assert.equal(result.reason, reason);
    assert.ok(!JSON.stringify(result).includes(apiKey));
    // 查询异常只回退到原有完整验证，不直接授权或被当作低风险。
    const pow = await f.captcha.createPow(context);
    assert.equal(pow.bits, 3);
    assert.ok((await f.captcha.verifyBehavior({ ...context, pow: { prefix: pow.prefix, nonce: nonceFor(pow) } })).challenge);
  }
});

test('超时同时覆盖连接与响应体，失败只短暂缓存并可自动恢复', async t => {
  for (const stalledBody of [false, true]) {
    let signal, finish;
    const f = fixture({ ipqs: { apiKey, timeoutMs: 20, fetch: async (_url, init) => {
      signal = init.signal;
      if (stalledBody) return { ok: true, json: () => new Promise(resolve => { finish = resolve; }) };
      return new Promise(resolve => { finish = resolve; });
    } } }); t.after(() => f.close());
    const result = await f.captcha.checkIpReputation(context);
    assert.equal(result.status, 'unavailable'); assert.equal(result.reason, 'timeout'); assert.equal(signal.aborted, true);
    finish(stalledBody ? { success: true, fraud_score: 0 } : response());
  }
  let calls = 0;
  const f = fixture({ ipqs: { apiKey, fetch: async () => { calls++; return calls === 1 ? Response.json({ success: false }) : response(15); } } }); t.after(() => f.close());
  assert.equal((await f.captcha.checkIpReputation(context)).status, 'unavailable');
  f.advance(29999);
  assert.equal((await f.captcha.checkIpReputation(context)).status, 'unavailable'); assert.equal(calls, 1);
  f.advance(1);
  assert.equal((await f.captcha.checkIpReputation(context)).fraudScore, 15); assert.equal(calls, 2);
});
