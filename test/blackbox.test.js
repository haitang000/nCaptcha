import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, nonceFor, challengeTrajectory } from './helpers.js';
import { configFromEnv } from '../src/server.js';
import { workerConfig } from '../workers/config.js';

const context = { ip: '8.8.8.8', action: 'login' };
const secret = 'blackbox-config-test-secret-at-least-32-characters';

test('Node 与 Workers 默认选 Blackbox，支持显式关闭与可选 IPQS', () => {
  for (const parse of [configFromEnv, workerConfig]) {
    assert.equal(parse({ CAPTCHA_SECRET: secret }).options.reputationProvider, 'blackbox');
    const config = parse({ CAPTCHA_SECRET: secret, CAPTCHA_IP_REPUTATION_PROVIDER: 'blackbox', CAPTCHA_BLACKBOX_TIMEOUT_MS: '1200', CAPTCHA_BLACKBOX_CACHE_TTL_MS: '1000', IPQS_API_KEY: 'unused-ipqs-key' });
    assert.equal(config.options.reputationProvider, 'blackbox'); assert.equal(config.options.blackbox.timeoutMs, 1200);
    assert.equal(config.options.blackbox.cacheTtlMs, 1000);
    assert.equal(parse({ CAPTCHA_SECRET: secret, CAPTCHA_IP_REPUTATION_PROVIDER: 'off' }).options.reputationProvider, 'off');
    assert.equal(parse({ CAPTCHA_SECRET: secret, IPQS_API_KEY: 'optional-ipqs-key' }).options.reputationProvider, 'ipqs');
    for (const extra of [{ CAPTCHA_IP_REPUTATION_PROVIDER: 'invalid' }, { CAPTCHA_IP_REPUTATION_PROVIDER: 'ipqs' }, { CAPTCHA_BLACKBOX_TIMEOUT_MS: '0' }, { CAPTCHA_BLACKBOX_CACHE_TTL_MS: 'NaN' }]) {
      assert.throws(() => parse({ CAPTCHA_SECRET: secret, ...extra }), TypeError);
    }
  }
  for (const options of [{ reputationProvider: 'bad' }, { reputationProvider: 'ipqs' }, { blackbox: null }, { blackbox: [] }, { blackbox: { timeoutMs: 10001 } }, { blackbox: { fetch: false } }]) {
    assert.throws(() => fixture(options), TypeError);
  }
});

test('Blackbox 单 IP 请求无需凭据，只接受 Y/N，命中加难度且仍需图片行为验证', async t => {
  for (const [verdict, listed, bits] of [['Y', true, 5], ['N', false, 3]]) {
    const calls = [];
    const f = fixture({ blackbox: { fetch: async (url, init) => { calls.push({ url, init }); return new Response(` ${verdict}\n`); } } }); t.after(() => f.close());
    const pow = await f.captcha.createPow(context);
    assert.equal(pow.bits, bits); assert.equal(pow.listed, undefined);
    const report = await f.captcha.checkIpReputation(context);
    assert.equal(report.provider, 'blackbox'); assert.equal(report.status, 'ok'); assert.equal(report.listed, listed);
    assert.equal(report.fraudScore, null); assert.equal(report.risk, 'unknown'); assert.equal(report.proxy, undefined);
    const { url, init } = calls[0];
    assert.equal(url.href, 'https://blackbox.ipinfo.app/api/v1/8.8.8.8');
    assert.equal(init.headers.Accept, 'text/plain'); assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.redirect, 'manual'); assert.equal(url.search, '');
    const { challenge, token } = await f.captcha.verifyBehavior({ ...context, listed: false, pow: { prefix: pow.prefix, nonce: nonceFor(pow) } });
    assert.ok(challenge); assert.equal(token, undefined);
    await assert.rejects(f.captcha.solveChallenge({ ...context, id: challenge.id, angle: -f.answer(challenge.id) }), error => error.code === 'BEHAVIOR_REJECTED');
    assert.ok((await f.captcha.solveChallenge({ ...context, id: challenge.id, angle: -f.answer(challenge.id), trajectory: challengeTrajectory })).token);
    assert.equal(calls.length, 1);
  }
});

test('Blackbox 按规范化 IP 缓存并合并并发，支持 IPv6，缓存过期后刷新', async t => {
  const calls = [];
  const f = fixture({ blackbox: { cacheTtlMs: 1000, fetch: async url => { calls.push(url); return new Response('Y'); } } }); t.after(() => f.close());
  const results = await Promise.all(Array.from({ length: 12 }, () => f.captcha.checkIpReputation(context)));
  assert.equal(calls.length, 1);
  results[0].listed = false;
  assert.equal(results[1].listed, true); assert.equal((await f.captcha.checkIpReputation(context)).listed, true);
  for (const ip of ['2001:4860:4860::8888', '2001:4860:4860:0:0:0:0:8888']) {
    assert.equal((await f.captcha.checkIpReputation({ ip })).ip, '2001:4860:4860::8888');
  }
  assert.equal(calls.length, 2);
  assert.equal(decodeURIComponent(calls[1].pathname.split('/').at(-1)), '2001:4860:4860::8888');
  f.advance(1000);
  assert.equal((await f.captcha.checkIpReputation(context)).listed, true); assert.equal(calls.length, 3);
});

test('E、畸形文本、HTTP 错误和网络异常明确为未知，不伪造命中或 0 分', async t => {
  const cases = [
    [() => new Response('E'), 'provider_error'],
    ...['', 'y', 'Y,N', 'true', '<html>error</html>'].map(body => [() => new Response(body), 'invalid_response']),
    [() => new Response('Y', { status: 429 }), 'http_error'],
    [() => new Response('', { status: 302, headers: { Location: 'https://other.example' } }), 'http_error'],
    [() => { throw new Error('network failure'); }, 'network_error'],
  ];
  for (const [response, reason] of cases) {
    const f = fixture({ blackbox: { fetch: async () => response() } }); t.after(() => f.close());
    const result = await f.captcha.checkIpReputation(context);
    assert.equal(result.status, 'unavailable'); assert.equal(result.reason, reason); assert.equal(result.listed, undefined);
    assert.equal(result.fraudScore, null); assert.equal(result.risk, 'unknown');
    const pow = await f.captcha.createPow(context);
    assert.equal(pow.bits, 3);
    assert.ok((await f.captcha.verifyBehavior({ ...context, pow: { prefix: pow.prefix, nonce: nonceFor(pow) } })).challenge);
  }
});

test('Blackbox 超时涵盖响应体，故障短暂缓存后恢复，off 与私网不出站', async t => {
  for (const stalledBody of [false, true]) {
    let signal, finish;
    const f = fixture({ blackbox: { timeoutMs: 20, fetch: async (_url, init) => {
      signal = init.signal;
      if (stalledBody) return { ok: true, text: () => new Promise(resolve => { finish = resolve; }) };
      return new Promise(resolve => { finish = resolve; });
    } } }); t.after(() => f.close());
    assert.equal((await f.captcha.checkIpReputation(context)).reason, 'timeout'); assert.equal(signal.aborted, true);
    finish(stalledBody ? 'Y' : new Response('Y'));
  }
  let calls = 0;
  const fetcher = async () => { calls++; return new Response(calls === 1 ? 'E' : 'N'); };
  const f = fixture({ blackbox: { fetch: fetcher } }); t.after(() => f.close());
  assert.equal((await f.captcha.checkIpReputation(context)).status, 'unavailable');
  f.advance(29999);
  assert.equal((await f.captcha.checkIpReputation(context)).status, 'unavailable'); assert.equal(calls, 1);
  f.advance(1);
  assert.equal((await f.captcha.checkIpReputation(context)).listed, false); assert.equal(calls, 2);
  for (const ip of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '::1', '2001:db8::1']) assert.equal((await f.captcha.checkIpReputation({ ip })).status, 'skipped');
  const off = fixture({ reputationProvider: 'off', blackbox: { fetch: fetcher } }); t.after(() => off.close());
  assert.equal((await off.captcha.checkIpReputation(context)).status, 'disabled'); assert.equal(calls, 2);
});

test('显式 Blackbox 配置覆盖可选 IPQS，命中难度仍受 28 位上限约束', async t => {
  let calls = 0;
  const f = fixture({ reputationProvider: 'blackbox', powBits: 27, ipqs: { apiKey: 'unused-ipqs-key', fetch: async () => { throw new Error('不应调用 IPQS'); } }, blackbox: { fetch: async () => { calls++; return new Response('Y'); } } }); t.after(() => f.close());
  assert.equal((await f.captcha.createPow(context)).bits, 28); assert.equal(calls, 1);
  assert.equal((await f.captcha.checkIpReputation(context)).provider, 'blackbox');
});
