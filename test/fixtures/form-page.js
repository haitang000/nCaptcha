// 仅供浏览器测试使用，不进入分发包。
export function serveFormPage(req, res, { apiUrl = '/captcha/v1', assetBaseUrl = '/captcha/assets/' } = {}) {
  if (req.method !== 'GET' || !['/test/form', '/test/module'].includes(req.url)) return false;
  const json = value => JSON.stringify(value).replaceAll('<', '\\u003c');
  const source = `
    const form = document.querySelector('form');
    const widget = Captcha.render('#captcha', { ...${json({ apiUrl, assetBaseUrl, action: 'demo' })}, form });
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
  const script = req.url === '/test/module'
    ? `<script type="module">import * as Captcha from ${json(assetBaseUrl + 'captcha.esm.js')};\n${source}</script>`
    : `<script src="${assetBaseUrl}captcha.js"></script><script>${source}</script>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CAPTCHA form test</title><body><form><label>用户名<input name="username" autocomplete="username"></label><div id="captcha"></div><button type="submit">验证并提交</button></form><p id="result" role="status"></p>${script}</body></html>`);
  return true;
}
