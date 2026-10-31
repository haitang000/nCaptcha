import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { startService } from '../src/server.js';

test('生产入口仅提供验证码 API、组件与健康检查，业务核验保留密钥和 IP 绑定', async t => {
  const origin = 'https://captcha.example';
  const server = startService({ host: '127.0.0.1', port: 0,
    options: { enabled: false, minTokenAgeMs: 0 },
    http: { secret: 'server-test-secret-at-least-32-characters', allowedOrigins: [origin], trustedProxies: ['127.0.0.1'] },
  });
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [path, type] of [['/captcha/assets/captcha.js', 'text/javascript'], ['/captcha/assets/captcha.esm.js', 'text/javascript'], ['/captcha/assets/captcha.css', 'text/css'], ['/captcha/assets/pow-worker.js', 'text/javascript']]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.ok(response.headers.get('content-type').startsWith(type), path);
  }
  for (const path of ['/', '/landing/app.js', '/landing/styles.css', '/landing/favicon.svg', '/examples', '/module', '/test/form', '/.env', '/src/server.js']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Forwarded-For': '192.0.2.10' };
  const post = (path, body, extra = {}) => fetch(base + path, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  const issue = async action => {
    const response = await post('/captcha/v1/verify', { action });
    assert.equal(response.status, 200);
    return (await response.json()).token;
  };
  const token = await issue('register');
  assert.ok(token);
  for (const method of ['GET', 'HEAD', 'POST']) {
    const response = await fetch(base + '/demo/verify', { method, ...(method === 'POST' ? { headers, body: JSON.stringify({ token }) } : {}) });
    assert.equal(response.status, 404, method);
  }
  const verify = (body, extra = {}) => fetch(base + '/captcha/v1/siteverify', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body),
  });
  const auth = { Authorization: 'Bearer server-test-secret-at-least-32-characters' };
  const body = { token, ip: '192.0.2.10', action: 'register' };
  assert.equal((await verify(body)).status, 401);
  assert.equal((await verify(body, { ...auth, Origin: origin })).status, 403);
  assert.deepEqual(await (await verify({ ...body, ip: '192.0.2.11' }, auth)).json(), { success: false });
  assert.deepEqual(await (await verify({ ...body, action: 'login' }, auth)).json(), { success: false });
  assert.deepEqual(await (await verify(body, auth)).json(), { success: true });
  assert.deepEqual(await (await verify(body, auth)).json(), { success: false });
  assert.equal((await fetch(base + '/captcha/v1/siteverify', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.deepEqual(await (await fetch(base + '/health')).json(), { ok: true });
});
