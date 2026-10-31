import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createHttpHandler, createExpressMiddleware, getClientIp } from '../src/http.js';
import { configFromEnv } from '../src/server.js';
import { fixture, nonceFor, challengeTrajectory } from './helpers.js';
const secret = 'test-secret-for-backend-only-123456789';
async function serverFor(t, options = {}, httpOptions = {}) {
  const f = fixture(options);
  const handler = createHttpHandler(f.captcha, { secret, allowedOrigins: ['https://business.example'], onError: null, ...httpOptions });
  const server = http.createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end(); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await f.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function post(path, data, headers = {}) { return fetch(base + '/captcha/v1' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) }); }
  return { ...f, base, post };
}
test('HTTP 完整严格验证 → 等待 → 后端带密钥核验 → 重放失败', async t => {
  const f = await serverFor(t, { minTokenAgeMs: 300 });
  const pow = await (await fetch(f.base + '/captcha/v1/pow?action=login')).json();
  const { challenge } = await (await f.post('/verify', { action: 'login', pow: { prefix: pow.prefix, nonce: nonceFor(pow) } })).json();
  assert.ok(challenge.image.startsWith('data:image/png;base64,')); assert.equal(challenge.answer, undefined);
  const result = await (await f.post('/challenge', { action: 'login', id: challenge.id, angle: -f.answer(challenge.id), trajectory: challengeTrajectory })).json();
  assert.equal((await f.post('/siteverify', { token: result.token, ip: '127.0.0.1', action: 'login' })).status, 401);
  const headers = { Authorization: `Bearer ${secret}` };
  const verifyBody = { token: result.token, ip: '127.0.0.1', action: 'login' };
  assert.equal((await (await f.post('/siteverify', verifyBody, headers)).json()).success, false);
  f.advance(300);
  assert.equal((await (await f.post('/siteverify', verifyBody, headers)).json()).success, true);
  assert.equal((await (await f.post('/siteverify', verifyBody, headers)).json()).success, false);
});

test('HTTP 透传 agent 蜜罐字段并返回机器人标记，不返回令牌', async t => {
  const f = await serverFor(t);
  const pow = await (await fetch(f.base + '/captcha/v1/pow?action=login')).json();
  const input = { action: 'login', pow: { prefix: pow.prefix, nonce: nonceFor(pow) }, agentSignal: 'automated-agent' };
  const response = await f.post('/verify', input);
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.code, 'BOT_DETECTED'); assert.equal(body.bot, true); assert.equal(body.token, undefined);
});

test('HTTP 备用接口仅接受有效票据的 POST，GET 与伪造请求不标记轮次', async t => {
  const f = await serverFor(t);
  const pow = await (await fetch(f.base + '/captcha/v1/pow?action=login')).json();
  const input = { action: 'login', ticket: pow.agent.ticket, source: 'fallback-api' };
  assert.equal((await fetch(f.base + '/captcha/v1/compat?' + new URLSearchParams(input))).status, 404);
  assert.equal((await f.post('/compat', { ...input, action: 'other' })).status, 403);
  assert.equal((await f.post('/compat', { source: 'fallback-api' })).status, 400);
  const response = await f.post('/compat', input);
  assert.equal(response.status, 403); assert.equal((await response.json()).source, 'fallback-api');
  assert.equal((await (await f.post('/verify', { action: 'login', pow: { prefix: pow.prefix, nonce: nonceFor(pow) } })).json()).code, 'BOT_DETECTED');
});
test('来源白名单、预检、核验不向浏览器开放、配置不泄露密钥', async t => {
  const f = await serverFor(t);
  const good = { Origin: 'https://business.example' };
  assert.equal((await f.post('/verify', {}, { Origin: 'https://evil.example' })).status, 403);
  const preflight = await fetch(f.base + '/captcha/v1/verify', { method: 'OPTIONS', headers: { ...good, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), good.Origin);
  const denied = await fetch(f.base + '/captcha/v1/siteverify', { method: 'OPTIONS', headers: { ...good, 'Access-Control-Request-Method': 'POST' } });
  assert.equal(denied.status, 403);
  assert.equal((await f.post('/siteverify', {}, { ...good, Authorization: `Bearer ${secret}` })).status, 403);
  const unknownHeader = await fetch(f.base + '/captcha/v1/verify', { method: 'OPTIONS', headers: { ...good, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization' } });
  assert.equal(unknownHeader.status, 403);
  for (const name of ['captcha.js', 'captcha.esm.js', 'captcha.css', 'pow-worker.js']) {
    const response = await fetch(f.base + '/captcha/assets/' + name);
    assert.equal(response.status, 200); assert.ok(!(await response.text()).includes(secret));
  }
});
test('格式错误、大小限制、请求限流与挂载路径', async t => {
  const f = await serverFor(t, { rateLimit: 2 });
  assert.equal((await fetch(f.base + '/captcha/v1/verify', { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await fetch(f.base + '/captcha/v1/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await f.post('/verify', [])).status, 400);
  assert.equal((await f.post('/verify', { large: 'x'.repeat(65537) })).status, 413);
  await fetch(f.base + '/captcha/v1/pow'); await fetch(f.base + '/captcha/v1/pow');
  const limited = await fetch(f.base + '/captcha/v1/pow');
  assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal((await fetch(f.base + '/unknown')).status, 404);
});
test('代理头默认忽略，只接受显式可信的紧邻代理追加地址', () => {
  const req = { socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { 'x-forwarded-for': '8.8.8.8, 192.0.2.4' } };
  assert.equal(getClientIp(req), '127.0.0.1');
  assert.equal(getClientIp(req, ['127.0.0.1']), '192.0.2.4');
  req.headers['x-forwarded-for'] = 'bad'; assert.equal(getClientIp(req, ['127.0.0.1']), '127.0.0.1');
});
test('Express 适配器接收已解析请求体并将未匹配请求交回宿主', async t => {
  const f = fixture({ enabled: false }); t.after(() => f.close());
  const middleware = createExpressMiddleware(f.captcha, { basePath: '/verification' });
  const req = { url: '/verification/verify', method: 'POST', socket: { remoteAddress: '127.0.0.1' }, headers: { 'content-type': 'application/json' }, body: { action: 'login' } };
  let body = '';
  const res = { setHeader() {}, writeHead(status) { assert.equal(status, 200); }, end(data) { body = data; } };
  await new Promise((resolve, reject) => { middleware(req, { ...res, end(data) { res.end(data); resolve(); } }, reject); });
  assert.ok(JSON.parse(body).token);
  await new Promise((resolve, reject) => middleware({ ...req, url: '/elsewhere' }, res, err => err ? reject(err) : resolve()));
});
test('服务环境变量严格校验，导入入口不启动服务', () => {
  assert.throws(() => configFromEnv({}), /CAPTCHA_SECRET/);
  assert.throws(() => configFromEnv({ CAPTCHA_SECRET: secret, CAPTCHA_ENABLED: 'maybe' }), /true/);
  const config = configFromEnv({ CAPTCHA_SECRET: secret, CAPTCHA_POW_BITS: '12', CAPTCHA_MODE: 'normal', CAPTCHA_ALLOWED_ORIGINS: 'https://business.example', CAPTCHA_TRUSTED_PROXIES: '127.0.0.1' });
  assert.equal(config.options.powBits, 12); assert.equal(config.options.mode, 'normal'); assert.equal(config.port, 8787);
});

test('Cloudflare IP 头只信任显式代理，拒绝无效头并恢复 Pseudo IPv4 的真实 IPv6', () => {
  const req = { socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { 'cf-connecting-ip': '8.8.8.8', 'x-forwarded-for': '1.1.1.1' } };
  assert.equal(getClientIp(req, [], 'cf-connecting-ip'), '127.0.0.1');
  assert.equal(getClientIp(req, ['127.0.0.1'], 'cf-connecting-ip'), '8.8.8.8');
  for (const value of [undefined, 'bad', '8.8.8.8, 1.1.1.1', ['8.8.8.8']]) {
    req.headers['cf-connecting-ip'] = value;
    assert.throws(() => getClientIp(req, ['127.0.0.1'], 'cf-connecting-ip'), error => error.code === 'CLIENT_IP_INVALID');
  }
  req.headers['cf-connecting-ip'] = '240.1.2.3';
  assert.throws(() => getClientIp(req, ['127.0.0.1'], 'cf-connecting-ip'), error => error.code === 'CLIENT_IP_INVALID');
  req.headers['cf-connecting-ipv6'] = '2001:4860:4860:0:0:0:0:8888';
  assert.equal(getClientIp(req, ['127.0.0.1'], 'cf-connecting-ip'), '2001:4860:4860::8888');
});

test('Tunnel HTTP 链路用访客 IP 查询 IPQS、提高 PoW，并保持令牌 IP 绑定和查询接口鉴权', async t => {
  const requests = [];
  const f = await serverFor(t, { ipqs: { apiKey: 'http-ipqs-private-key', fetch: async url => {
    requests.push(decodeURIComponent(url.pathname.split('/').at(-1)));
    return Response.json({ success: true, fraud_score: 75, proxy: true });
  } } }, { trustedProxies: ['127.0.0.1'], clientIpHeader: 'cf-connecting-ip' });
  const headers = { 'CF-Connecting-IP': '8.8.8.8', 'X-Forwarded-For': '1.1.1.1' };
  const powResponse = await fetch(f.base + '/captcha/v1/pow?action=login', { headers });
  assert.equal(powResponse.status, 200);
  const pow = await powResponse.json();
  assert.equal(pow.bits, 5); assert.equal(pow.fraudScore, undefined);
  const { challenge } = await (await f.post('/verify', { action: 'login', ip: '1.1.1.1', pow: { prefix: pow.prefix, nonce: nonceFor(pow) } }, headers)).json();
  assert.ok(challenge);
  const result = await (await f.post('/challenge', { action: 'login', id: challenge.id, angle: -f.answer(challenge.id), trajectory: challengeTrajectory }, headers)).json();
  assert.ok(result.token); assert.deepEqual(requests, ['8.8.8.8']);
  const auth = { Authorization: `Bearer ${secret}` };
  assert.equal((await (await f.post('/siteverify', { action: 'login', token: result.token, ip: '1.1.1.1' }, auth)).json()).success, false);
  assert.equal((await (await f.post('/siteverify', { action: 'login', token: result.token, ip: '8.8.8.8' }, auth)).json()).success, true);
  assert.equal((await f.post('/reputation', { ip: '8.8.8.8' })).status, 401);
  assert.equal((await f.post('/reputation', { ip: '8.8.8.8' }, { ...auth, Origin: 'https://business.example' })).status, 403);
  assert.equal((await fetch(f.base + '/captcha/v1/reputation', { headers: auth })).status, 403);
  assert.equal((await fetch(f.base + '/captcha/v1/reputation', { method: 'OPTIONS', headers: { Origin: 'https://business.example', 'Access-Control-Request-Method': 'POST' } })).status, 403);
  const lookup = await (await f.post('/reputation', { ip: '8.8.8.8' }, auth)).json();
  assert.equal(lookup.fraudScore, 75); assert.equal(lookup.status, 'ok'); assert.equal(lookup.risk, 'medium');
  assert.equal(lookup.proxy, true); assert.ok(!JSON.stringify(lookup).includes('http-ipqs-private-key')); assert.equal(requests.length, 1);
  const missing = await fetch(f.base + '/captcha/v1/pow');
  assert.equal(missing.status, 400); assert.equal((await missing.json()).code, 'CLIENT_IP_INVALID');
});

test('Tunnel HTTP 默认查询 Blackbox，名单命中影响 PoW，完整验证与后端查询不需要供应商 Key', async t => {
  const requests = [];
  const f = await serverFor(t, { blackbox: { fetch: async url => { requests.push(url.href); return new Response('Y'); } } }, { trustedProxies: ['127.0.0.1'], clientIpHeader: 'cf-connecting-ip' });
  const headers = { 'CF-Connecting-IP': '8.8.8.8', 'X-Forwarded-For': '1.1.1.1' };
  const pow = await (await fetch(f.base + '/captcha/v1/pow?action=login', { headers })).json();
  assert.equal(pow.bits, 5);
  const { challenge } = await (await f.post('/verify', { action: 'login', ip: '1.1.1.1', listed: false, pow: { prefix: pow.prefix, nonce: nonceFor(pow) } }, headers)).json();
  const result = await (await f.post('/challenge', { action: 'login', id: challenge.id, angle: -f.answer(challenge.id), trajectory: challengeTrajectory }, headers)).json();
  assert.ok(result.token);
  const auth = { Authorization: `Bearer ${secret}` };
  assert.equal((await (await f.post('/siteverify', { action: 'login', token: result.token, ip: '1.1.1.1' }, auth)).json()).success, false);
  assert.equal((await (await f.post('/siteverify', { action: 'login', token: result.token, ip: '8.8.8.8' }, auth)).json()).success, true);
  assert.equal((await f.post('/reputation', { ip: '8.8.8.8' })).status, 401);
  const report = await (await f.post('/reputation', { ip: '8.8.8.8' }, auth)).json();
  assert.equal(report.provider, 'blackbox'); assert.equal(report.listed, true); assert.equal(report.fraudScore, null);
  assert.deepEqual(requests, ['https://blackbox.ipinfo.app/api/v1/8.8.8.8']);
});
