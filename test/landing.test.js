import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { serveLanding } from '../src/landing.js';
import { sendJson } from '../src/http.js';
import { fixture, solved } from './helpers.js';

async function landingFor(t) {
  const f = fixture();
  let base;
  const server = http.createServer(async (req, res) => {
    try {
      if (!await serveLanding(req, res, { captcha: f.captcha, allowedOrigins: [base] })) sendJson(res, 404, {});
    } catch (error) { sendJson(res, error.status ?? 500, { code: error.code }); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await f.close(); });
  const post = (body, origin = base) => fetch(base + '/demo/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
  return { ...f, base, post };
}

test('Landing 静态资源有正确类型；私有题库和未列入白名单的资源不可读取', async t => {
  const { base } = await landingFor(t);
  for (const [path, type] of [['/', 'text/html'], ['/landing/styles.css', 'text/css'], ['/landing/app.js', 'text/javascript'], ['/landing/favicon.svg', 'image/svg+xml']]) {
    const response = await fetch(base + path); assert.equal(response.status, 200); assert.ok(response.headers.get('content-type').startsWith(type));
    const head = await fetch(base + path, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
  }
  for (const path of ['/landing/../../.dev.vars', '/.workers/puzzles.js', '/landing/index.html']) assert.equal((await fetch(base + path)).status, 404);
});

test('公开 Demo 核验仅消费同 IP 的专用令牌，拒绝业务令牌、跨站请求和重放', async t => {
  const f = await landingFor(t);
  const business = await solved(f, { ip: '127.0.0.1', action: 'register' });
  assert.equal((await f.post({ token: business.token, action: 'register' })).status, 400);
  assert.equal(await f.captcha.consumeToken({ token: business.token, ip: '127.0.0.1', action: 'register' }), true);
  const foreign = await solved(f, { ip: '192.0.2.1', action: 'landing-demo' });
  assert.equal((await f.post({ token: foreign.token, ip: '192.0.2.1' })).status, 400);
  const demo = await solved(f, { ip: '127.0.0.1', action: 'landing-demo' });
  assert.equal((await f.post({ token: demo.token }, 'https://evil.example')).status, 403);
  assert.equal((await f.post({ token: demo.token }, null)).status, 403);
  assert.deepEqual(await (await f.post({ token: demo.token })).json(), { success: true });
  assert.equal((await f.post({ token: demo.token })).status, 400);
});

test('Demo 核验保留请求方法与 JSON 格式校验', async t => {
  const f = await landingFor(t);
  assert.equal((await fetch(f.base + '/demo/verify')).status, 405);
  assert.equal((await fetch(f.base + '/demo/verify', { method: 'POST', headers: { Origin: f.base }, body: '{}' })).status, 415);
  assert.equal((await fetch(f.base + '/demo/verify', { method: 'POST', headers: { Origin: f.base, 'Content-Type': 'application/json' }, body: '{' })).status, 400);
});
