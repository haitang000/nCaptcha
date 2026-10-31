// 专用测试服务。答案接口与测试页面均不包含在 npm 包中。
import http from 'node:http';
import { createCaptcha, createMemoryStore } from '../src/index.js';
import { createHttpHandler, sendJson, readJson, getClientIp } from '../src/http.js';
import { serveFormPage } from './fixtures/form-page.js';
import { startBusinessServer } from './fixtures/business-server.js';
const records = new Map();
const memory = createMemoryStore();
const store = { ...memory, async set(key, value, ttl) { if (key.includes(':challenge:')) records.set(key.split(':').at(-1), value); return memory.set(key, value, ttl); } };
const captcha = createCaptcha({ store, powBits: 4, minSolveMs: 100, minTokenAgeMs: 150, tokenTtlMs: 3000, rateLimit: 10000 });
const secret = 'test-private-service-secret-123456789';
const handler = createHttpHandler(captcha, { secret, allowedOrigins: ['http://127.0.0.1:18877', 'http://127.0.0.1:18878'], onError: console.error });
const server = http.createServer(async (req, res) => {
  try {
    if (await handler(req, res)) return;
    if (req.url === '/test') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CAPTCHA test</title><body><form id="form"><input name="user"></form><div id="one"></div><div id="two"></div><script src="/captcha/assets/captcha.js"></script></body></html>'); return; }
    if (req.url === '/state') { sendJson(res, 200, Object.fromEntries(records)); return; }
    if (req.url === '/submit' && req.method === 'POST') {
      const body = await readJson(req); const success = await captcha.consumeToken({ ip: getClientIp(req), action: 'demo', token: body.token });
      sendJson(res, success ? 200 : 400, { success }); return;
    }
    if (serveFormPage(req, res)) return;
    res.writeHead(404); res.end();
  } catch (err) { sendJson(res, 500, { error: err.message }); }
});
server.listen(18877, '127.0.0.1');
const business = startBusinessServer({ port: 18878, secret, captchaUrl: 'http://127.0.0.1:18877' });
process.once('SIGTERM', () => { server.close(); business.close(); void captcha.close(); void memory.close(); });
