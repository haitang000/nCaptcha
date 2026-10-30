import http from 'node:http';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readJson, getClientIp, sendJson } from '../../src/http.js';
import { servePage, notFound } from '../shared.js';

export function startStandaloneDemo({ secret, captchaUrl = 'http://127.0.0.1:8787', port = 8788 } = {}) {
if (!secret || secret.length < 32) throw new Error('请先设置与 CAPTCHA 服务一致的 CAPTCHA_SECRET');
captchaUrl = captchaUrl.replace(/\/$/, '');
const server = http.createServer(async (req, res) => {
  try {
    if (await servePage(req, res, { apiUrl: captchaUrl + '/captcha/v1', assetBaseUrl: captchaUrl + '/captcha/assets/' })) return;
    if (req.url === '/submit' && req.method === 'POST') {
      if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) { sendJson(res, 403, { error: '来源不正确' }); return; }
      const { token } = await readJson(req);
      const verification = await fetch(captchaUrl + '/captcha/v1/siteverify', { method: 'POST', signal: AbortSignal.timeout(5000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` }, body: JSON.stringify({ token, ip: getClientIp(req), action: 'demo' }) });
      const data = await verification.json();
      if (!verification.ok || !data.success) { sendJson(res, 400, { error: '远程令牌核验未通过' }); return; }
      sendJson(res, 200, { success: true }); return;
    }
    notFound(res);
  } catch (err) { sendJson(res, err.status ?? 502, { error: err.message }); }
});
server.listen(port, '127.0.0.1', () => console.log(`独立服务接入示例：http://127.0.0.1:${port}`));
return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (existsSync('.env')) process.loadEnvFile('.env');
  startStandaloneDemo({ secret: process.env.CAPTCHA_SECRET, captchaUrl: process.env.CAPTCHA_SERVICE_URL });
}
