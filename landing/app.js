/* Landing page uses the shipped widget and same-origin verification API. */
(() => {
  const $ = selector => document.querySelector(selector);
  const status = $('#demo-status');
  const statusText = $('#status-text');
  const result = $('#demo-result');
  const submit = $('#submit-token');
  const reset = $('#reset-demo');
  let widget;
  let startedAt = 0;
  let generation = 0;
  let submitting = false;
  const setStatus = (state, text) => { status.dataset.state = state; statusText.textContent = text; };

  try {
    if (!window.Captcha) throw new Error('验证码组件加载失败，请刷新页面重试');
    $('#widget-loading').remove();
    widget = Captcha.render('#demo-captcha', {
      apiUrl: '/captcha/v1', assetBaseUrl: '/captcha/assets/', action: 'landing-demo', prewarm: false,
      onStateChange(state) {
        if (state === 'loading') { startedAt = performance.now(); result.hidden = true; setStatus('loading', '正在验证，请完成图片回正…'); }
        if (state === 'idle') { result.hidden = true; setStatus('idle', '准备就绪，等你开始'); }
      },
      onSuccess(token) {
        const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
        setStatus('verified', `验证通过 · 用时 ${seconds} 秒`);
        $('#token-preview').textContent = `${token.slice(0, 8)}…${token.slice(-8)}`;
        submit.disabled = false;
        submit.textContent = '提交到服务端核验 →';
        result.hidden = false;
      },
      onError(error) { setStatus('error', error.message || '验证失败，请重试'); },
      onExpire() { generation++; setStatus('idle', '令牌已过期，请重新验证'); },
    });
  } catch (error) {
    const message = $('#widget-loading') || document.createElement('p');
    message.id = 'widget-loading'; message.textContent = error.message;
    $('#demo-captcha').append(message);
    setStatus('error', '组件暂不可用，请刷新重试');
    reset.disabled = true;
  }

  reset.addEventListener('click', () => {
    generation++;
    widget?.reset();
    result.hidden = true;
    $('#token-preview').textContent = '';
    setStatus('idle', '已重置，再试一次吧');
  });

  submit.addEventListener('click', async () => {
    const token = widget?.getToken();
    if (!token || submitting) return;
    const attempt = generation;
    submitting = true; submit.disabled = true; reset.disabled = true;
    setStatus('loading', '正在由服务端核验令牌…');
    try {
      const response = await fetch('/demo/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }), signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.error || '核验未通过，请重新验证');
      if (attempt !== generation) return;
      widget.reset(); result.hidden = false;
      submit.disabled = true; submit.textContent = '✓ 服务端核验成功，令牌已消费';
      setStatus('consumed', '完整验证已完成 · 点击重试可再次体验');
    } catch (error) {
      if (attempt !== generation) return;
      widget.reset();
      setStatus('error', error.name === 'TimeoutError' ? '核验超时，请重新验证' : error.message);
    } finally { submitting = false; reset.disabled = false; }
  });

  document.querySelectorAll('[data-start]').forEach(link => link.addEventListener('click', () => {
    if (!widget) return;
    if (!submitting && !result.hidden) { generation++; widget.reset(); }
    requestAnimationFrame(() => $('#demo-captcha .captcha-host')?.shadowRoot?.querySelector('button')?.focus({ preventScroll: true }));
  }));

  document.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => {
    $('.demo-card').dataset.theme = button.dataset.themeChoice;
    document.querySelectorAll('[data-theme-choice]').forEach(choice => choice.setAttribute('aria-pressed', String(choice === button)));
  }));

  const snippets = {
    script: `<div id="captcha"></div>\n<script src="/captcha/assets/captcha.js"><\/script>\n<script>\n  const captcha = Captcha.render('#captcha', {\n    apiUrl: '/captcha/v1', action: 'register',\n  });\n\n  async function onSubmit() {\n    const token = await captcha.verify();\n    // 将 token 交给业务后端核验\n  }\n<\/script>`,
    module: `import { render } from\n  '/captcha/assets/captcha.esm.js';\n\nconst captcha = render('#captcha', {\n  apiUrl: '/captcha/v1',\n  action: 'register',\n});\n\nconst token = await captcha.verify();\n// 将 token 交给业务后端核验\n// 页面卸载时：captcha.destroy();`,
    server: `// 仅在业务服务端执行，密钥不能暴露到浏览器\nconst response = await fetch(\n  CAPTCHA_URL + '/captcha/v1/siteverify', {\n    method: 'POST',\n    headers: {\n      Authorization: 'Bearer ' + CAPTCHA_SECRET,\n      'Content-Type': 'application/json',\n    },\n    body: JSON.stringify({ token, ip, action: 'register' }),\n  });\nconst { success } = await response.json();\n// success 为 true 后再执行业务操作`,
  };
  let activeCode = 'script';
  let copyTimer;
  const selectCode = button => {
    activeCode = button.dataset.code;
    $('#integration-code').textContent = snippets[activeCode];
    $('#code-content').setAttribute('aria-labelledby', button.id);
    document.querySelectorAll('[data-code]').forEach(tab => {
      tab.setAttribute('aria-selected', String(tab === button)); tab.tabIndex = tab === button ? 0 : -1;
    });
    clearTimeout(copyTimer); $('#copy-code span').textContent = '复制';
  };
  const tabs = [...document.querySelectorAll('[data-code]')];
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectCode(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault(); selectCode(tabs[next]); tabs[next].focus();
    });
  });
  selectCode(tabs[0]);
  $('#copy-code').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(snippets[activeCode]);
      $('#copy-code span').textContent = '已复制';
    } catch {
      const range = document.createRange(); range.selectNodeContents($('#integration-code'));
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      $('#copy-code span').textContent = '请手动复制';
    }
    clearTimeout(copyTimer); copyTimer = setTimeout(() => { $('#copy-code span').textContent = '复制'; }, 2500);
  });
  window.addEventListener('pagehide', event => { if (!event.persisted) widget?.destroy(); });
})();
