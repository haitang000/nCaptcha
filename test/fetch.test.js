import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFetchHandler, readRequestJson } from '../src/fetch.js';
import { fixture, nonceFor } from './helpers.js';

const secret = 'worker-secret-for-backend-only-1234567';
const context = { ip: '192.0.2.4', action: 'login' };
test('Web Request/Response 适配器执行严格验证和受保护的核验', async t => {
  const f = fixture(); t.after(() => f.close());
  const handle = createFetchHandler(f.captcha, { secret, allowedOrigins: ['https://app.example'], getIp: () => context.ip });
  const req = (path, body, headers = {}) => new Request('https://captcha.example/captcha/v1' + path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const pow = await (await handle(req('/pow?action=login'))).json();
  const { challenge } = await (await handle(req('/verify', { action: 'login', pow: { prefix: pow.prefix, nonce: nonceFor(pow) }, ip: '1.1.1.1' }))).json();
  const result = await (await handle(req('/challenge', { action: 'login', id: challenge.id, angle: -f.answer(challenge.id) }))).json();
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
