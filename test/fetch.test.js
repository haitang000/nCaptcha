import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFetchHandler, readRequestJson } from '../src/fetch.js';
import { fixture, nonceFor, challengeTrajectory } from './helpers.js';

const secret = 'worker-secret-for-backend-only-1234567';
const context = { ip: '192.0.2.4', action: 'login' };

test('Web POST PoW、verify 和 challenge 只使用实际头，频率由核心统计', async t => {
  const f = fixture(); t.after(() => f.close());
  const inputs = [];
  const observed = Object.fromEntries(['createPow', 'verifyBehavior', 'solveChallenge'].map(method => [method, input => { inputs.push(input); return f.captcha[method](input); }]));
  const handle = createFetchHandler(observed, { getIp: () => context.ip });
  const hints = { dpr: 1, sw: 1920, sh: 1080, vw: 1000, vh: 800, tz: 0, timeZone: 'UTC', lang: ['zh-CN'] };
  const post = (path, body) => handle(new Request('https://captcha.example/captcha/v1' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'curl/8', 'Accept-Language': 'de', Cookie: 'private', Authorization: 'private' },
    body: JSON.stringify({ ...body, requestHeaders: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'zh' }, frequency: { count: 0 } }),
  }));
  const pow = await (await post('/pow', { action: 'login', hints })).json();
  assert.equal(pow.bits, 4);
  const { challenge } = await (await post('/verify', { action: 'login', hints, pow: { prefix: pow.prefix, nonce: nonceFor(pow) } })).json();
  const result = await (await post('/challenge', { action: 'login', hints, id: challenge.id, angle: -f.answer(challenge.id), trajectory: challengeTrajectory })).json();
  assert.ok(result.token);
  assert.ok(inputs.every(input => input.requestHeaders['user-agent'] === 'curl/8' && !('cookie' in input.requestHeaders) && !('authorization' in input.requestHeaders)));
  assert.equal(result.risk, undefined); assert.equal(result.requestAssessment, undefined);
});
test('Web 备用接口支持自定义路径，GET 不消费票据，禁止来源与伪造 IP 无效', async t => {
  const f = fixture(); t.after(() => f.close());
  const handle = createFetchHandler(f.captcha, { basePath: '/custom', getIp: () => context.ip, allowedOrigins: ['https://app.example'] });
  const pow = await f.captcha.createPow(context);
  const data = { action: context.action, ticket: pow.agent.ticket, source: 'compat-event', ip: '192.0.2.99' };
  const request = (headers = {}) => new Request('https://captcha.example/custom/compat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
  assert.equal((await handle(new Request('https://captcha.example/custom/compat'))).status, 404);
  assert.equal((await handle(request({ Origin: 'https://evil.example' }))).status, 403);
  const response = await handle(request({ Origin: 'https://app.example' }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).source, 'compat-event');
});

test('Web 适配器透传 agent 蜜罐字段并返回 403 机器人标记', async t => {
  const f = fixture(); t.after(() => f.close());
  const handle = createFetchHandler(f.captcha, { getIp: () => context.ip });
  const pow = await f.captcha.createPow(context);
  const response = await handle(new Request('https://captcha.example/captcha/v1/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: context.action, pow: { prefix: pow.prefix, nonce: nonceFor(pow) }, agentSignal: 'automated-agent' }),
  }));
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.code, 'BOT_DETECTED'); assert.equal(body.bot, true); assert.equal(body.token, undefined);
});

test('Web Request/Response 适配器执行严格验证和受保护的核验', async t => {
  const f = fixture(); t.after(() => f.close());
  const handle = createFetchHandler(f.captcha, { secret, allowedOrigins: ['https://app.example'], getIp: () => context.ip });
  const req = (path, body, headers = {}) => new Request('https://captcha.example/captcha/v1' + path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const pow = await (await handle(req('/pow?action=login'))).json();
  const { challenge } = await (await handle(req('/verify', { action: 'login', pow: { prefix: pow.prefix, nonce: nonceFor(pow) }, ip: '1.1.1.1' }))).json();
  const result = await (await handle(req('/challenge', { action: 'login', id: challenge.id, angle: -f.answer(challenge.id), trajectory: challengeTrajectory }))).json();
  const data = { token: result.token, ...context };
  assert.equal((await handle(req('/siteverify', data))).status, 401);
  assert.equal((await handle(req('/siteverify', data, { Authorization: `Bearer ${secret}`, Origin: 'https://app.example' }))).status, 403);
  assert.equal((await (await handle(req('/siteverify', data, { Authorization: `Bearer ${secret}` }))).json()).success, true);
  assert.equal((await (await handle(req('/siteverify', data, { Authorization: `Bearer ${secret}` }))).json()).success, false);
  assert.equal(await handle(new Request('https://captcha.example/other')), null);
});
test('Web 适配器白名单、预检、静态资源及请求格式与限流', async t => {
  const f = fixture({ enabled: false, rateLimit: 1 }); t.after(() => f.close());
  const handle = createFetchHandler(f.captcha, { secret, allowedOrigins: ['https://app.example'], getIp: () => context.ip, serveAsset: name => new Response(name, { headers: { 'Content-Type': 'text/javascript' } }) });
  const request = (path, init = {}) => new Request('https://captcha.example' + path, init);
  const preflight = await handle(request('/captcha/v1/verify', { method: 'OPTIONS', headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://app.example');
  assert.equal((await handle(request('/captcha/v1/pow', { headers: { Origin: 'https://evil.example' } }))).status, 403);
  const asset = await handle(request('/captcha/assets/captcha.js'));
  assert.equal(await asset.text(), 'captcha.js'); assert.equal(asset.headers.get('Cross-Origin-Resource-Policy'), 'cross-origin');
  assert.equal(await (await handle(request('/captcha/assets/captcha.js', { method: 'HEAD' }))).text(), '');
  assert.equal(await handle(request('/captcha/assets/puzzles.js')), null);
  assert.equal((await handle(request('/captcha/v1/verify', { method: 'POST', body: '{}' }))).status, 415);
  assert.equal((await handle(request('/captcha/v1/pow'))).status, 200);
  const limited = await handle(request('/captcha/v1/pow'));
  assert.equal(limited.status, 429); assert.ok(limited.headers.get('Retry-After'));
});
test('Web JSON 限制同时覆盖 Content-Length 和没有声明长度的流', async () => {
  for (const body of ['{', 'null', '[]']) await assert.rejects(readRequestJson(new Request('https://example.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })), error => error.code === 'INVALID_JSON');
  await assert.rejects(readRequestJson(new Request('https://example.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(65536) }) })), error => error.code === 'BODY_TOO_LARGE');
});

test('Web 信誉分查询只允许带密钥的后端 POST，查询异常明确返回未知', async t => {
  let calls = 0;
  const f = fixture({ ipqs: { apiKey: 'fetch-ipqs-private-key', fetch: async () => { calls++; return Response.json({ success: false }); } } }); t.after(() => f.close());
  const handle = createFetchHandler(f.captcha, { secret, getIp: () => context.ip, allowedOrigins: ['https://app.example'] });
  const request = (headers = {}) => new Request('https://captcha.example/captcha/v1/reputation', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ ip: '8.8.8.8' }) });
  assert.equal((await handle(request())).status, 401);
  assert.equal((await handle(request({ Authorization: `Bearer ${secret}`, Origin: 'https://app.example' }))).status, 403);
  assert.equal((await handle(new Request('https://captcha.example/captcha/v1/reputation', { method: 'OPTIONS', headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'POST' } }))).status, 403);
  assert.equal(calls, 0);
  const response = await handle(request({ Authorization: `Bearer ${secret}` }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ip, '8.8.8.8'); assert.equal(body.status, 'unavailable'); assert.equal(body.fraudScore, null); assert.equal(body.risk, 'unknown');
});
