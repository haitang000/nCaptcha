import fs from 'node:fs/promises';
import { sendJson } from '../src/http.js';

export async function servePage(req, res, { apiUrl = '/captcha/v1', assetBaseUrl = '/captcha/assets/', pagePath = '/' } = {}) {
  if (req.method !== 'GET' || ![pagePath, '/module'].includes(req.url)) return false;
  const template = await fs.readFile(new URL('./page.html', import.meta.url), 'utf8');
  // 配置只由示例服务端提供，编码为安全的 JS 字面量。
  const json = value => JSON.stringify(value).replaceAll('<', '\\u003c');
  const script = req.url === '/module'
    ? `<script type="module">import * as Captcha from ${json(assetBaseUrl + 'captcha.esm.js')};\n${clientSource(apiUrl, assetBaseUrl)}</script>`
    : `<script src="${assetBaseUrl}captcha.js"></script><script>${clientSource(apiUrl, assetBaseUrl)}</script>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(template.replace('href="/"', `href="${pagePath}"`).replace('<!-- CAPTCHA_SCRIPT -->', script)); return true;
}
function clientSource(apiUrl, assetBaseUrl) {
  return `
    const form = document.querySelector('form');
    const config = ${JSON.stringify({ apiUrl, assetBaseUrl, action: 'demo' }).replaceAll('<', '\\u003c')};
    const widget = Captcha.render('#captcha', { ...config, form });
    const second = Captcha.render('#second-captcha', { ...config, action: 'secondary', prewarm: false });
    document.querySelector('#rebuild').onclick = () => { second.destroy(); document.querySelector('#second-captcha').textContent = '组件已销毁，刷新页面可重建'; };
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const submit = form.querySelector('button[type=submit]'), result = document.querySelector('#result');
      submit.disabled = true; result.textContent = '';
      try {
        const token = await widget.verify();
        if (!token) { result.textContent = '验证已取消'; return; }
        const response = await fetch('/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '提交失败');
        result.textContent = '业务提交成功：后端已核验并消费令牌';
      } catch (err) { result.textContent = err.message; }
      finally { widget.reset(); submit.disabled = false; }
    });
  `;
}
export function notFound(res) { sendJson(res, 404, { error: '未找到' }); }
