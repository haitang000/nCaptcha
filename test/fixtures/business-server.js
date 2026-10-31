// 模拟持有密钥的业务后端，验证跨域组件与 /siteverify 接入。
import http from 'node:http';
import { readJson, getClientIp, sendJson } from '../../src/http.js';
import { serveFormPage } from './form-page.js';

export function startBusinessServer({ secret, captchaUrl, port }) {
  const allowedOrigins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  const server = http.createServer(async (req, res) => {
    try {
      if (serveFormPage(req, res, { apiUrl: captchaUrl + '/captcha/v1', assetBaseUrl: captchaUrl + '/captcha/assets/' })) return;
      if (req.url === '/submit' && req.method === 'POST') {
        if (req.headers.origin && !allowedOrigins.includes(req.headers.origin)) { sendJson(res, 403, { error: '来源不正确' }); return; }
        const { token } = await readJson(req);
        const verification = await fetch(captchaUrl + '/captcha/v1/siteverify', {
          method: 'POST', signal: AbortSignal.timeout(5000),
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
          body: JSON.stringify({ token, ip: getClientIp(req), action: 'demo' }),
        });
        const data = await verification.json();
        if (!verification.ok || !data.success) { sendJson(res, 400, { error: '远程令牌核验未通过' }); return; }
        sendJson(res, 200, { success: true }); return;
      }
      sendJson(res, 404, { error: '未找到' });
    } catch (err) { sendJson(res, err.status ?? 502, { error: err.message }); }
  });
  server.listen(port, '127.0.0.1');
  return server;
}
