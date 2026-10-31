import { createTracking, createChallengeTracking } from './tracking.js';
import { solvePow, delay, abortError } from './pow.js';
import logo from './logo.svg';

const defaultAssets = new URL('./', import.meta.url).href;
const checkmark = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="4 12 9 17 20 6"/></svg>';
export class CaptchaClientError extends Error {
  constructor(message, code = 'CLIENT_ERROR', details = {}) { super(message); this.name = 'CaptchaClientError'; this.code = code; Object.assign(this, details); }
}
export function render(container, options = {}) {
  if (typeof container === 'string') container = document.querySelector(container);
  if (!(container instanceof HTMLElement)) throw new TypeError('container 必须为元素或有效选择器');
  const apiUrl = new URL(options.apiUrl ?? '/captcha/v1', document.baseURI).href.replace(/\/$/, '');
  const assets = new URL(options.assetBaseUrl ?? defaultAssets, document.baseURI).href.replace(/\/?$/, '/');
  const action = options.action ?? 'default';
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(action)) throw new TypeError('action 格式不正确');
  const form = typeof options.form === 'string' ? document.querySelector(options.form) : options.form;
  if (form && !(form instanceof HTMLFormElement)) throw new TypeError('form 必须为表单元素或选择器');
  const host = document.createElement('span');
  host.className = 'captcha-host';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<button type="button" class="widget" aria-pressed="false"><span class="mark" aria-hidden="true"></span><span class="label" aria-live="polite">我不是机器人</span></button><span class="feedback" role="status"></span>';
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('captcha.css', assets).href; root.prepend(css);
  container.append(host);
  const button = root.querySelector('button'), label = root.querySelector('.label'), mark = root.querySelector('.mark'), feedback = root.querySelector('.feedback');
  const tracking = createTracking(button, form);
  const lifetime = new AbortController();
  let controller = new AbortController(), task = null, prepared = null, proofTask = null, token = null, expiresAt = 0, expiryTimer = null, dialog = null, cancelPuzzle = null, challengeId = null, destroyed = false;
  const notify = (name, ...args) => { try { options[name]?.(...args); } catch (err) { console.error('[captcha] 回调异常', err); } };
  const motion = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;
  function state(value, text, error = '') {
    if (destroyed) return;
    const from = button.getBoundingClientRect().width;
    button.className = `widget ${value}`; label.textContent = text; feedback.textContent = error;
    button.setAttribute('aria-pressed', String(value === 'verified'));
    button.setAttribute('aria-busy', String(value === 'loading'));
    mark.innerHTML = value === 'verified' ? checkmark : value === 'loading' ? '<span class="dots"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>' : '';
    if (motion() && button.animate) {
      button.animate([{ width: `${from}px` }, { width: `${button.getBoundingClientRect().width}px` }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
      label.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
    }
    notify('onStateChange', value);
  }
  async function request(path, body, signal = controller.signal) {
    const started = performance.now();
    const response = await (options.fetch ?? fetch)(apiUrl + path, { method: body === undefined ? 'GET' : 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store', signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify({ ...body, action }) });
    const data = await response.json();
    if (!response.ok) throw new CaptchaClientError(data.error || '验证请求失败', data.code, { status: response.status, triesRemaining: data.triesRemaining, retryAfterMs: data.retryAfterMs });
    return { ...data, roundTripMs: performance.now() - started };
  }
  function prepareToken(result) {
    if (typeof result.token !== 'string' || !/^[a-f0-9]{64}$/.test(result.token) || !Number.isFinite(result.expiresInMs) || result.expiresInMs <= 0 || !Number.isFinite(result.usableAfterMs) || result.usableAfterMs < 0) throw new CaptchaClientError('服务端返回了不正确的令牌');
    const receivedAt = performance.now();
    return { ...result, tokenExpiresAt: receivedAt + result.expiresInMs - (result.roundTripMs ?? 0), tokenUsableAt: receivedAt + result.usableAfterMs };
  }
  function prepareProof(signal = controller.signal) {
    if (prepared && prepared.deadline > performance.now() + 1000) return Promise.resolve(prepared.pow);
    if (proofTask) return proofTask;
    const job = (async () => {
      const proof = await request(`/pow?action=${encodeURIComponent(action)}`, undefined, signal);
      const deadline = performance.now() + proof.expiresInMs - proof.roundTripMs;
      const nonce = await solvePow({ ...proof, expiresInMs: Math.max(1, deadline - performance.now()) }, options.workerUrl ?? new URL('pow-worker.js', assets).href, signal);
      if (signal.aborted) throw abortError();
      prepared = { pow: { prefix: proof.prefix, nonce }, deadline };
      return prepared.pow;
    })();
    proofTask = job;
    void job.finally(() => { if (proofTask === job) proofTask = null; }).catch(() => {});
    return job;
  }
  function releaseChallenge(id) { if (id) void request('/cancel', { id }, AbortSignal.timeout(3000)).catch(() => {}); }
  function puzzle(challenge, signal) {
    return new Promise((resolve, reject) => {
      if (!challenge || !/^[a-f0-9]{32}$/.test(challenge.id) || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(challenge.image)) { reject(new CaptchaClientError('服务端返回了不正确的图片挑战')); return; }
      challengeId = challenge.id;
      const dlg = document.createElement('dialog'); dialog = dlg; dlg.className = 'puzzle';
      const titleId = `captcha-title-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
      dlg.setAttribute('aria-labelledby', titleId);
      const helpId = `${titleId}-help`;
      dlg.innerHTML = `<p class="puzzle-eyebrow" role="status">请进行安全验证</p><h3 id="${titleId}" tabindex="-1">拖动滑块, 使图片方向为<strong>正</strong></h3>
        <div class="stage-viewport"><div class="stage" tabindex="0" role="slider" aria-label="旋转图片" aria-describedby="${helpId}" aria-valuemin="0" aria-valuemax="359" aria-valuenow="0" aria-valuetext="0 度">
          <img alt="旋转验证图片" draggable="false"><span class="stage-spinner" aria-hidden="true"></span>
          <span class="stage-result" aria-hidden="true"><svg viewBox="0 0 64 64"><path class="stage-check" pathLength="1" d="M16 33 28 45 49 21"/><path class="stage-cross" pathLength="1" d="m22 22 20 20 m0-20-20 20"/></svg></span>
        </div></div><div class="error-text" role="alert"></div><input class="range" type="range" min="0" max="359" step="1" value="0" aria-label="旋转图片角度" aria-describedby="${helpId}"><img class="puzzle-logo" width="99" height="20" alt="NCaptcha" draggable="false"><p id="${helpId}" class="sr-only">拖动滑块，松开后验证。也可用方向键微调，按 Enter 确认；按 Escape 或点击弹窗外取消。</p><button type="button" class="puzzle-cancel" data-cancel aria-label="取消验证">取消</button>`;
      dlg.querySelector('.puzzle-logo').src = logo;
      root.append(dlg);
      const viewport = dlg.querySelector('.stage-viewport'), stage = dlg.querySelector('.stage'), img = dlg.querySelector('img'), range = dlg.querySelector('.range'), eyebrow = dlg.querySelector('.puzzle-eyebrow'), errEl = dlg.querySelector('.error-text');
      img.src = challenge.image;
      const challengeTracking = createChallengeTracking(dlg);
      let deg = 0, drag = null, settled = false, submitting = false, keyboardAdjusting = false, rangeCancelled = false;
      const events = new AbortController();
      const listen = (el, type, fn) => el.addEventListener(type, fn, { signal: events.signal });
      const finish = (value, error) => {
        if (settled) return; settled = true; events.abort(); challengeTracking.cleanup(); signal.removeEventListener('abort', aborted);
        clearTimeout(challengeTimer);
        if (challengeId === challenge.id) challengeId = null;
        if (!value) releaseChallenge(challenge.id);
        for (const animation of dlg.getAnimations?.({ subtree: true }) ?? []) animation.cancel();
        // 保持 dialog 在顶层，等卡片与遮罩退场后再真正关闭。
        const remove = () => {
          if (dlg.open) dlg.close(); dlg.remove();
          if (dialog === dlg) { dialog = null; cancelPuzzle = null; }
          error ? reject(error) : resolve(value);
        };
        if (!dlg.open) { remove(); return; }
        dlg.inert = true; dlg.classList.add('is-closing');
        const exiting = dlg.getAnimations?.() ?? [];
        if (exiting.length) void Promise.allSettled(exiting.map(animation => animation.finished)).then(remove);
        else if (motion()) setTimeout(remove, 160);
        else remove();
      };
      const aborted = () => finish(null, abortError());
      const expireChallenge = () => finish(null, new CaptchaClientError('图片挑战已过期，请重新验证', 'CHALLENGE_EXPIRED'));
      let challengeTimer = setTimeout(expireChallenge, Math.max(1, challenge.expiresInMs));
      cancelPuzzle = () => finish(null);
      signal.addEventListener('abort', aborted, { once: true });
      function paint(value) {
        if (settled || submitting) return;
        deg = ((value % 360) + 360) % 360; img.style.transform = `rotate(${deg}deg)`;
        range.value = String(Math.round(deg) % 360);
        range.setAttribute('aria-valuetext', `${Math.round(deg) % 360} 度`);
        stage.setAttribute('aria-valuenow', String(Math.round(deg) % 360)); stage.setAttribute('aria-valuetext', `${Math.round(deg) % 360} 度`);
        errEl.textContent = ''; dlg.classList.remove('has-error');
      }
      async function nextRound() {
        eyebrow.textContent = '正在更换图片…'; dlg.setAttribute('aria-busy', 'true');
        // 先释放旧题占用的名额，再出新题；重新计算 PoW，沿用服务端的限流与风控。
        const [, pow] = await Promise.all([request('/cancel', { id: challenge.id }, events.signal), prepareProof(events.signal)]);
        prepared = null;
        const response = await request('/verify', { pow }, events.signal);
        const next = response.challenge;
        if (!next || !/^[a-f0-9]{32}$/.test(next.id) || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(next.image) || !Number.isFinite(next.expiresInMs) || next.expiresInMs <= 0) throw new CaptchaClientError('服务端返回了不正确的图片挑战');
        if (settled) { releaseChallenge(next.id); return; }
        challenge = next; challengeId = next.id;
        challengeTimer = setTimeout(expireChallenge, Math.max(1, next.expiresInMs - response.roundTripMs));
        // 解码完成后再换图，避免新图片滑入时出现空白。
        const preload = new Image(); preload.src = next.image;
        await preload.decode();
        if (settled) return;
        const outgoing = stage.cloneNode(true);
        outgoing.className = 'stage-outgoing'; outgoing.removeAttribute('tabindex'); outgoing.removeAttribute('role'); outgoing.setAttribute('aria-hidden', 'true'); outgoing.inert = true;
        viewport.append(outgoing);
        img.src = next.image; img.style.transform = 'rotate(0deg)'; deg = 0;
        range.value = '0'; range.setAttribute('aria-valuetext', '0 度');
        stage.setAttribute('aria-valuenow', '0'); stage.setAttribute('aria-valuetext', '0 度'); stage.dataset.phase = 'switching';
        errEl.textContent = ''; dlg.classList.remove('has-error');
        const animations = [];
        try {
          if (motion() && stage.animate) {
            const distance = viewport.clientWidth, timing = { duration: 260, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'both' };
            animations.push(outgoing.animate([{ transform: 'translateX(0)' }, { transform: `translateX(-${distance}px)` }], timing));
            animations.push(stage.animate([{ transform: `translateX(${distance}px)` }, { transform: 'translateX(0)' }], timing));
            await Promise.allSettled(animations.map(animation => animation.finished));
          }
        } finally {
          for (const animation of animations) animation.cancel();
          outgoing.remove();
        }
        if (settled) return;
        challengeTracking.reset();
        submitting = false; keyboardAdjusting = false; rangeCancelled = false;
        range.disabled = false; stage.removeAttribute('aria-disabled'); delete stage.dataset.phase;
        dlg.removeAttribute('aria-busy'); eyebrow.textContent = '请进行安全验证';
        range.focus({ preventScroll: true });
      }
      async function submit() {
        if (submitting || settled || signal.aborted) return;
        // 禁用滑块前把焦点留在弹窗内，加载期间仍可用 Escape 取消。
        if (root.activeElement === range) dlg.querySelector('h3').focus({ preventScroll: true });
        submitting = true; range.disabled = true; errEl.textContent = '';
        const checkingSince = performance.now(), feedbackMs = motion() ? 560 : 300, exitMs = motion() ? 160 : 0;
        dlg.classList.remove('has-error'); dlg.setAttribute('aria-busy', 'true'); stage.setAttribute('aria-disabled', 'true'); stage.dataset.phase = 'loading'; eyebrow.textContent = '正在验证…';
        let result = null, failure = null;
        const behavior = challengeTracking.snapshot();
        const payload = { id: challenge.id, angle: Math.round(deg) % 360, ...behavior, hints: { ...tracking.getHints(), pointer: behavior.pointer } };
        try {
          for (let attempt = 0; attempt < 2; attempt++) {
            try { result = prepareToken(await request('/challenge', payload, events.signal)); break; }
            catch (error) {
              // 松手比最低求解间隔早时等待剩余时间；不要求用户再次拖动。
              if (attempt === 0 && error.code === 'TOO_FAST' && Number.isFinite(error.retryAfterMs) && error.retryAfterMs > 0) { await delay(error.retryAfterMs + 25, events.signal); continue; }
              throw error;
            }
          }
        } catch (error) {
          failure = error;
        }
        if (settled) return;
        clearTimeout(challengeTimer);
        // 请求与最短加载反馈并行；使用同一个可取消信号管理所有等待。
        try {
          await delay(Math.max(0, 500 - (performance.now() - checkingSince)), events.signal);
          if (result && result.tokenExpiresAt <= performance.now() + feedbackMs + exitMs) {
            result = null; failure = new CaptchaClientError('令牌已过期，请重新验证', 'TOKEN_EXPIRED');
          }
          stage.dataset.phase = failure ? 'failure' : 'success';
          dlg.removeAttribute('aria-busy'); eyebrow.textContent = failure ? '验证失败' : '验证通过';
          if (failure) { errEl.textContent = failure.message; dlg.classList.add('has-error'); }
          const drawing = dlg.querySelector(failure ? '.stage-cross' : '.stage-check').getAnimations?.() ?? [];
          await Promise.allSettled(drawing.map(animation => animation.finished));
          if (settled) return;
          await delay(drawing.length ? 180 : motion() ? feedbackMs : 300, events.signal);
          if (settled) return;
          if (failure && ['ANGLE_INCORRECT', 'BEHAVIOR_REJECTED', 'CHALLENGE_EXHAUSTED', 'CHALLENGE_EXPIRED'].includes(failure.code)) await nextRound();
          else finish(result, failure);
        } catch (error) {
          if (!settled) finish(null, error);
        }
      }
      const angleOf = e => { const r = stage.getBoundingClientRect(); return Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2) * 180 / Math.PI; };
      listen(range, 'input', () => paint(Number(range.value)));
      listen(range, 'pointerdown', () => { keyboardAdjusting = false; rangeCancelled = false; });
      listen(range, 'pointercancel', () => { rangeCancelled = true; });
      listen(range, 'change', () => { if (!keyboardAdjusting && !rangeCancelled) void submit(); });
      listen(range, 'keydown', e => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) keyboardAdjusting = true;
        if (e.key === 'Enter') { e.preventDefault(); void submit(); }
      });
      listen(stage, 'keydown', e => {
        if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); paint(deg + (e.key === 'ArrowLeft' ? -15 : 15)); }
        if (e.key === 'Enter') { e.preventDefault(); void submit(); }
      });
      listen(stage, 'pointerdown', e => { if (e.button !== 0 || submitting) return; drag = { offset: angleOf(e) - deg, pointer: e.pointerId, moved: false }; stage.setPointerCapture(e.pointerId); stage.classList.add('dragging'); e.preventDefault(); });
      listen(stage, 'pointermove', e => { if (drag && e.pointerId === drag.pointer) { drag.moved = true; paint(angleOf(e) - drag.offset); } });
      listen(stage, 'pointerup', e => { if (!drag || e.pointerId !== drag.pointer) return; const moved = drag.moved; drag = null; stage.classList.remove('dragging'); if (moved) void submit(); });
      for (const event of ['pointercancel', 'lostpointercapture']) listen(stage, event, () => { drag = null; stage.classList.remove('dragging'); });
      listen(dlg.querySelector('[data-cancel]'), 'click', () => finish(null));
      listen(dlg, 'keydown', e => { if (e.key === 'Escape') { e.preventDefault(); finish(null); } });
      listen(dlg, 'cancel', e => { e.preventDefault(); finish(null); });
      listen(dlg, 'close', () => finish(null));
      listen(dlg, 'click', e => { if (e.target === dlg) { const r = dlg.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) finish(null); } });
      try { dlg.showModal(); dlg.querySelector('h3').focus({ preventScroll: true }); } catch (err) { finish(null, err); }
    });
  }
  function reset() {
    if (destroyed) return;
    controller.abort(); cancelPuzzle?.(); controller = new AbortController();
    clearTimeout(expiryTimer); expiryTimer = null; token = null; expiresAt = 0; prepared = null; proofTask = null; task = null;
    state('idle', '我不是机器人');
  }
  function getToken() { if (token && performance.now() >= expiresAt) { reset(); notify('onExpire'); } return token; }
  function verify() {
    if (destroyed) return Promise.reject(new CaptchaClientError('组件已销毁', 'DESTROYED'));
    if (getToken()) return Promise.resolve(token);
    if (task) return task;
    const signal = controller.signal;
    const job = (async () => {
      state('loading', '正在验证');
      try {
        const pow = await prepareProof(); prepared = null;
        let result = await request('/verify', { pow, trajectory: tracking.getTrajectory(), formBehavior: tracking.getFormBehavior(), hints: tracking.getHints() }, signal);
        if (signal.aborted) throw abortError();
        result = result.challenge ? await puzzle(result.challenge, signal) : prepareToken(result);
        if (signal.aborted) throw abortError();
        if (!result) { state('idle', '我不是机器人'); return null; }
        const until = result.tokenExpiresAt;
        await delay(Math.max(0, result.tokenUsableAt - performance.now()), signal);
        if (until <= performance.now()) throw new CaptchaClientError('令牌已过期，请重新验证', 'TOKEN_EXPIRED');
        token = result.token; expiresAt = until;
        expiryTimer = setTimeout(() => { reset(); notify('onExpire'); }, Math.max(1, until - performance.now()));
        state('verified', '验证通过'); notify('onSuccess', result.token); return result.token;
      } catch (error) {
        if (!signal.aborted) { state('error', '验证失败，点击重试', error.message); notify('onError', error); }
        throw error;
      }
    })();
    task = job;
    void job.finally(() => { if (task === job) task = null; }).catch(() => {});
    return job;
  }
  button.addEventListener('click', e => {
    if (motion() && !button.classList.contains('verified')) { const ripple = document.createElement('span'); ripple.className = 'ripple'; const r = button.getBoundingClientRect(); ripple.style.left = `${e.clientX ? e.clientX - r.left : r.width / 2}px`; ripple.style.top = `${e.clientY ? e.clientY - r.top : r.height / 2}px`; button.append(ripple); ripple.addEventListener('animationend', () => ripple.remove(), { once: true }); }
    void verify().catch(() => {});
  }, { signal: lifetime.signal });
  if (options.prewarm !== false) void prepareProof().catch(() => {});
  return { verify, getToken, reset, destroy() { if (destroyed) return; reset(); destroyed = true; lifetime.abort(); tracking.cleanup(); dialog?.remove(); host.remove(); notify('onStateChange', 'destroyed'); } };
}
export const Captcha = { render };
export default Captcha;
