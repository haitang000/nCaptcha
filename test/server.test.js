import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { startService } from '../src/server.js';

test('生产入口提供首页与组件，代理后的演示核验与 API 使用同一 IP，业务密钥保护保持有效', async t => {
  const origin = 'https://captcha.example';
  const server = startService({ host: '127.0.0.1', port: 0,
    options: { enabled: false, minTokenAgeMs: 0 },
    http: { secret: 'server-test-secret-at-least-32-characters', allowedOrigins: [origin], trustedProxies: ['127.0.0.1'] },
  });
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [path, type] of [['/', 'text/html'], ['/landing/app.js', 'text/javascript'], ['/landing/styles.css', 'text/css'], ['/landing/favicon.svg', 'image/svg+xml'], ['/captcha/assets/captcha.js', 'text/javascript']]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.ok(response.headers.get('content-type').startsWith(type), path);
  }
  for (const path of ['/.env', '/src/server.js', '/landing/unknown.js']) assert.equal((await fetch(base + path)).status, 404);
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Forwarded-For': '192.0.2.10' };
  const post = (path, body, extra = {}) => fetch(base + path, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  const issue = async action => {
    const response = await post('/captcha/v1/verify', { action });
    assert.equal(response.status, 200);
    return (await response.json()).token;
  };
  const demoToken = await issue('landing-demo');
  assert.ok(demoToken);
  assert.equal((await post('/demo/verify', { token: demoToken }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('/demo/verify', { token: demoToken }, { 'X-Forwarded-For': '192.0.2.11' })).status, 400);
  assert.equal((await post('/demo/verify', { token: await issue('register') })).status, 400);
  assert.deepEqual(await (await post('/demo/verify', { token: demoToken })).json(), { success: true });
  assert.equal((await post('/demo/verify', { token: demoToken })).status, 400);
  assert.equal((await fetch(base + '/captcha/v1/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await fetch(base + '/demo/verify', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.deepEqual(await (await fetch(base + '/health')).json(), { ok: true });
});
