import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createCaptcha } from '../../src/index.js';
import { createHttpHandler, getClientIp, readJson, sendJson } from '../../src/http.js';
import { servePage, notFound } from '../shared.js';

export function startEmbeddedDemo({ port = 8787, captchaOptions = {} } = {}) {
  const captcha = createCaptcha(captchaOptions);
  const handler = createHttpHandler(captcha, { allowedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`] });
  const server = http.createServer(async (req, res) => {
    try {
      if (await handler(req, res) || await servePage(req, res)) return;
      if (req.url === '/submit' && req.method === 'POST') {
        const origin = req.headers.origin;
        if (origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin)) { sendJson(res, 403, { error: '来源不正确' }); return; }
        const body = await readJson(req);
        if (!await captcha.consumeToken({ token: body.token, ip: getClientIp(req), action: 'demo' })) { sendJson(res, 400, { error: '令牌无效，请重新验证' }); return; }
        sendJson(res, 200, { success: true }); return;
      }
      notFound(res);
    } catch (err) { sendJson(res, err.status ?? 500, { error: err.message }); }
  });
  server.on('close', () => { void captcha.close(); });
  server.listen(port, '127.0.0.1', () => console.log(`嵌入式示例：http://127.0.0.1:${server.address().port}`));
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startEmbeddedDemo();
