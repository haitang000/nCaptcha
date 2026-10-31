var Captcha = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/client/index.js
  var index_exports = {};
  __export(index_exports, {
    Captcha: () => Captcha,
    CaptchaClientError: () => CaptchaClientError,
    default: () => index_default,
    render: () => render
  });

  // src/client/tracking.js
  function sampleTrajectory(points, limit = 100) {
    if (points.length < 5) return null;
    const n = Math.min(limit, points.length), start = points[0].t;
    return Array.from({ length: n }, (_, i) => {
      const p = points[Math.round(i * (points.length - 1) / (n - 1))];
      return { x: p.x, y: p.y, t: p.t - start };
    });
  }
  function createTracking(anchor, form) {
    const listeners = new AbortController();
    const { signal } = listeners;
    const doc = anchor.ownerDocument, win = doc.defaultView;
    const coarse = win.matchMedia("(pointer: coarse)").matches;
    const trajectory = [], gestures = [];
    let current = null, pointer = coarse ? "touch" : "mouse";
    function push(points, event) {
      const t = performance.now();
      const p = event.touches?.[0] ?? event.changedTouches?.[0] ?? event;
      if (!p || !Number.isFinite(p.clientX) || points.length && t <= points.at(-1).t) return;
      points.push({ x: Math.round(p.clientX), y: Math.round(p.clientY), t });
      if (points.length > 500) points.splice(0, 250);
    }
    function start(e) {
      pointer = e.pointerType || "touch";
      if (pointer === "touch" || pointer === "pen") {
        current = [];
        push(current, e);
      } else push(trajectory, e);
    }
    function move(e) {
      if (e.pointerType) pointer = e.pointerType;
      if (pointer === "touch" || pointer === "pen") {
        if (current) push(current, e);
      } else push(trajectory, e);
    }
    function end(e) {
      if (current) {
        push(current, e);
        gestures.push(current);
        if (gestures.length > 8) gestures.shift();
        current = null;
      }
    }
    const listen = (target, type, fn) => target.addEventListener(type, fn, { passive: true, signal });
    if ("PointerEvent" in win) {
      listen(doc, "pointerdown", start);
      listen(doc, "pointermove", move);
      listen(doc, "pointerup", end);
      listen(doc, "pointercancel", end);
    } else {
      listen(doc, "touchstart", start);
      listen(doc, "touchmove", move);
      listen(doc, "touchend", end);
      listen(doc, "touchcancel", end);
      listen(doc, "mousemove", (e) => {
        pointer = "mouse";
        push(trajectory, e);
      });
    }
    const fields = /* @__PURE__ */ new Map(), focusOrder = [], startedAt = performance.now();
    if (form) {
      for (const [i, input] of [...form.querySelectorAll("input, textarea")].slice(0, 32).entries()) {
        const name = `field${i}`;
        const init = () => {
          if (!fields.has(name)) {
            fields.set(name, { n: 0, last: 0, sum: 0, sumSq: 0 });
            focusOrder.push(name);
          }
          return fields.get(name);
        };
        listen(input, "focus", init);
        listen(input, "input", () => {
          const field = init(), time = performance.now();
          if (field.n >= 1e5) return;
          if (field.n) {
            const gap = time - field.last;
            field.sum += gap;
            field.sumSq += gap * gap;
          }
          field.n++;
          field.last = time;
        });
      }
    }
    return {
      getHints() {
        return {
          dpr: Math.max(0.5, Math.min(4, win.devicePixelRatio || 1)),
          sw: win.screen.width,
          sh: win.screen.height,
          tz: (/* @__PURE__ */ new Date()).getTimezoneOffset(),
          lang: [...win.navigator.languages?.length ? win.navigator.languages : [win.navigator.language]].slice(0, 8),
          pointer,
          coarse
        };
      },
      getTrajectory() {
        if (coarse || pointer === "touch" || pointer === "pen") {
          const rect = anchor.getBoundingClientRect();
          for (const gesture of [...gestures].reverse()) {
            const end2 = gesture.at(-1);
            const length = gesture.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - gesture[i].x, p.y - gesture[i].y), 0);
            if (Math.hypot(end2.x - rect.left - rect.width / 2, end2.y - rect.top - rect.height / 2) <= 160 && length <= 320 && gesture.length >= 5) return sampleTrajectory(gesture);
          }
        }
        return sampleTrajectory(trajectory);
      },
      getFormBehavior() {
        const result = {};
        for (const [name, f] of fields) if (f.n >= 2) {
          const mean = f.sum / (f.n - 1);
          result[name] = { n: f.n, meanGap: Math.round(mean), varGap: Math.round(Math.max(0, f.sumSq / (f.n - 1) - mean ** 2)) };
        }
        return Object.values(result).reduce((n, f) => n + f.n, 0) >= 3 ? { fields: result, totalMs: Math.round(performance.now() - startedAt), focusOrder } : null;
      },
      cleanup() {
        listeners.abort();
        trajectory.length = gestures.length = 0;
        fields.clear();
      }
    };
  }

  // src/client/hash.js
  var K = new Uint32Array([
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ]);
  var rotr = (x, n) => x >>> n | x << 32 - n;
  var encoder = new TextEncoder();
  function sha256Hex(msg) {
    const bytes = encoder.encode(msg);
    const bitLen = bytes.length * 8;
    const len = ((bytes.length + 8 >> 6) + 1) * 64;
    const buf = new Uint8Array(len);
    buf.set(bytes);
    buf[bytes.length] = 128;
    const dv = new DataView(buf.buffer);
    dv.setUint32(len - 8, Math.floor(bitLen / 4294967296));
    dv.setUint32(len - 4, bitLen >>> 0);
    const w = new Uint32Array(64);
    let h0 = 1779033703, h1 = 3144134277, h2 = 1013904242, h3 = 2773480762;
    let h4 = 1359893119, h5 = 2600822924, h6 = 528734635, h7 = 1541459225;
    for (let i = 0; i < len; i += 64) {
      for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4);
      for (let j = 16; j < 64; j++) {
        const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ w[j - 15] >>> 3;
        const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ w[j - 2] >>> 10;
        w[j] = w[j - 16] + s0 + w[j - 7] + s1 >>> 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let j = 0; j < 64; j++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const t1 = h + S1 + (e & f ^ ~e & g) + K[j] + w[j] >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const t2 = S0 + (a & b ^ a & c ^ b & c) >>> 0;
        h = g;
        g = f;
        f = e;
        e = d + t1 >>> 0;
        d = c;
        c = b;
        b = a;
        a = t1 + t2 >>> 0;
      }
      h0 = h0 + a >>> 0;
      h1 = h1 + b >>> 0;
      h2 = h2 + c >>> 0;
      h3 = h3 + d >>> 0;
      h4 = h4 + e >>> 0;
      h5 = h5 + f >>> 0;
      h6 = h6 + g >>> 0;
      h7 = h7 + h >>> 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7].map((v) => v.toString(16).padStart(8, "0")).join("");
  }
  function createPowChecker(prefix, bits) {
    const bytes = encoder.encode(prefix);
    const limit = 2 ** (32 - bits);
    if (bytes.length > 45) return (nonce) => powPasses(sha256Hex(prefix + nonce), bits);
    const block = new Uint8Array(64);
    block.set(bytes);
    const view = new DataView(block.buffer);
    const w = new Uint32Array(64);
    let previousLength = 0;
    return (nonce) => {
      let digits = 1;
      for (let n = nonce; n >= 10; n = Math.floor(n / 10)) digits++;
      const length = bytes.length + digits;
      if (length !== previousLength) {
        block.fill(0, bytes.length);
        block[length] = 128;
        view.setUint32(60, length * 8);
        previousLength = length;
      }
      for (let i = length - 1, n = nonce; i >= bytes.length; i--) {
        block[i] = 48 + n % 10;
        n = Math.floor(n / 10);
      }
      for (let j = 0; j < 16; j++) w[j] = view.getUint32(j * 4);
      for (let j = 16; j < 64; j++) {
        const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ w[j - 15] >>> 3;
        const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ w[j - 2] >>> 10;
        w[j] = w[j - 16] + s0 + w[j - 7] + s1 >>> 0;
      }
      let a = 1779033703, b = 3144134277, c = 1013904242, d = 2773480762;
      let e = 1359893119, f = 2600822924, g = 528734635, h = 1541459225;
      for (let j = 0; j < 64; j++) {
        const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const t1 = h + s1 + (e & f ^ ~e & g) + K[j] + w[j] >>> 0;
        const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const t2 = s0 + (a & b ^ a & c ^ b & c) >>> 0;
        h = g;
        g = f;
        f = e;
        e = d + t1 >>> 0;
        d = c;
        c = b;
        b = a;
        a = t1 + t2 >>> 0;
      }
      return 1779033703 + a >>> 0 < limit;
    };
  }
  function powPasses(hex, bits) {
    if (bits <= 0) return true;
    let zeros = 0;
    for (let i = 0; i < hex.length; i++) {
      const nib = parseInt(hex[i], 16);
      if (nib === 0) {
        zeros += 4;
        continue;
      }
      for (let b = 8; b > 0 && (nib & b) === 0; b >>= 1) zeros++;
      break;
    }
    return zeros >= bits;
  }

  // src/client/pow.js
  function abortError() {
    return new DOMException("\u9A8C\u8BC1\u5DF2\u53D6\u6D88", "AbortError");
  }
  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(abortError());
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  async function solvePow({ prefix, bits, expiresInMs }, workerUrl, signal) {
    if (!Number.isInteger(bits) || bits < 0 || bits > 28 || typeof prefix !== "string" || prefix.length > 128 || !Number.isFinite(expiresInMs) || expiresInMs <= 0) throw new Error("\u670D\u52A1\u7AEF\u8FD4\u56DE\u4E86\u4E0D\u6B63\u786E\u7684 PoW \u53C2\u6570");
    if (signal.aborted) throw abortError();
    if (!bits) return "0";
    const deadline = performance.now() + expiresInMs;
    let worker;
    try {
      if (typeof Worker !== "undefined") {
        worker = new Worker(workerUrl);
        return await new Promise((resolve, reject) => {
          const stop = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", cancel);
          };
          const cancel = () => {
            stop();
            reject(abortError());
          };
          const timer = setTimeout(() => {
            stop();
            reject(new Error("\u9A8C\u8BC1\u8BA1\u7B97\u8D85\u65F6"));
          }, expiresInMs);
          signal.addEventListener("abort", cancel, { once: true });
          worker.onmessage = ({ data }) => {
            stop();
            data?.nonce != null ? resolve(data.nonce) : reject(new Error(data?.error || "\u9A8C\u8BC1\u8BA1\u7B97\u5931\u8D25"));
          };
          worker.onerror = (event) => {
            event.preventDefault();
            stop();
            reject(new Error("Worker \u4E0D\u53EF\u7528"));
          };
          worker.postMessage({ prefix, bits });
        });
      }
    } catch (err) {
      if (signal.aborted) throw abortError();
    } finally {
      worker?.terminate();
    }
    const passes = createPowChecker(prefix, bits);
    let nonce = 0;
    while (nonce <= 2147483647 && performance.now() < deadline) {
      const end = Math.min(deadline, performance.now() + 8);
      do {
        const stop = Math.min(nonce + 128, 2147483648);
        for (; nonce < stop; nonce++) if (passes(nonce)) return String(nonce);
      } while (nonce <= 2147483647 && performance.now() < end);
      await delay(0, signal);
    }
    throw new Error("\u9A8C\u8BC1\u8BA1\u7B97\u8D85\u65F6\uFF0C\u8BF7\u91CD\u8BD5");
  }

  // src/client/index.js
  var defaultAssets = new URL("./", document.currentScript.src).href;
  var checkmark = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="4 12 9 17 20 6"/></svg>';
  var CaptchaClientError = class extends Error {
    constructor(message, code = "CLIENT_ERROR", details = {}) {
      super(message);
      this.name = "CaptchaClientError";
      this.code = code;
      Object.assign(this, details);
    }
  };
  function render(container, options = {}) {
    if (typeof container === "string") container = document.querySelector(container);
    if (!(container instanceof HTMLElement)) throw new TypeError("container \u5FC5\u987B\u4E3A\u5143\u7D20\u6216\u6709\u6548\u9009\u62E9\u5668");
    const apiUrl = new URL(options.apiUrl ?? "/captcha/v1", document.baseURI).href.replace(/\/$/, "");
    const assets = new URL(options.assetBaseUrl ?? defaultAssets, document.baseURI).href.replace(/\/?$/, "/");
    const action = options.action ?? "default";
    if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(action)) throw new TypeError("action \u683C\u5F0F\u4E0D\u6B63\u786E");
    const form = typeof options.form === "string" ? document.querySelector(options.form) : options.form;
    if (form && !(form instanceof HTMLFormElement)) throw new TypeError("form \u5FC5\u987B\u4E3A\u8868\u5355\u5143\u7D20\u6216\u9009\u62E9\u5668");
    const host = document.createElement("span");
    host.className = "captcha-host";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<button type="button" class="widget" aria-pressed="false"><span class="mark" aria-hidden="true"></span><span class="label" aria-live="polite">\u6211\u4E0D\u662F\u673A\u5668\u4EBA</span></button><span class="feedback" role="status"></span>';
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = new URL("captcha.css", assets).href;
    root.prepend(css);
    container.append(host);
    const button = root.querySelector("button"), label = root.querySelector(".label"), mark = root.querySelector(".mark"), feedback = root.querySelector(".feedback");
    const tracking = createTracking(button, form);
    const lifetime = new AbortController();
    let controller = new AbortController(), task = null, prepared = null, proofTask = null, token = null, expiresAt = 0, expiryTimer = null, dialog = null, cancelPuzzle = null, challengeId = null, destroyed = false;
    const notify = (name, ...args) => {
      try {
        options[name]?.(...args);
      } catch (err) {
        console.error("[captcha] \u56DE\u8C03\u5F02\u5E38", err);
      }
    };
    const motion = () => !matchMedia("(prefers-reduced-motion: reduce)").matches;
    function state(value, text, error = "") {
      if (destroyed) return;
      const from = button.getBoundingClientRect().width;
      button.className = `widget ${value}`;
      label.textContent = text;
      feedback.textContent = error;
      button.setAttribute("aria-pressed", String(value === "verified"));
      button.setAttribute("aria-busy", String(value === "loading"));
      mark.innerHTML = value === "verified" ? checkmark : value === "loading" ? '<span class="dots"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>' : "";
      if (motion() && button.animate) {
        button.animate([{ width: `${from}px` }, { width: `${button.getBoundingClientRect().width}px` }], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" });
        label.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
      }
      notify("onStateChange", value);
    }
    async function request(path, body, signal = controller.signal) {
      const started = performance.now();
      const response = await (options.fetch ?? fetch)(apiUrl + path, {
        method: body === void 0 ? "GET" : "POST",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        signal,
        headers: body === void 0 ? void 0 : { "Content-Type": "application/json" },
        body: body === void 0 ? void 0 : JSON.stringify({ ...body, action })
      });
      const data = await response.json();
      if (!response.ok) throw new CaptchaClientError(data.error || "\u9A8C\u8BC1\u8BF7\u6C42\u5931\u8D25", data.code, { status: response.status, triesRemaining: data.triesRemaining, retryAfterMs: data.retryAfterMs });
      return { ...data, roundTripMs: performance.now() - started };
    }
    function prepareToken(result) {
      if (typeof result.token !== "string" || !/^[a-f0-9]{64}$/.test(result.token) || !Number.isFinite(result.expiresInMs) || result.expiresInMs <= 0 || !Number.isFinite(result.usableAfterMs) || result.usableAfterMs < 0) throw new CaptchaClientError("\u670D\u52A1\u7AEF\u8FD4\u56DE\u4E86\u4E0D\u6B63\u786E\u7684\u4EE4\u724C");
      const receivedAt = performance.now();
      return { ...result, tokenExpiresAt: receivedAt + result.expiresInMs - (result.roundTripMs ?? 0), tokenUsableAt: receivedAt + result.usableAfterMs };
    }
    function prepareProof() {
      if (prepared && prepared.deadline > performance.now() + 1e3) return Promise.resolve(prepared.pow);
      if (proofTask) return proofTask;
      const signal = controller.signal;
      const job = (async () => {
        const proof = await request(`/pow?action=${encodeURIComponent(action)}`, void 0, signal);
        const deadline = performance.now() + proof.expiresInMs - proof.roundTripMs;
        const nonce = await solvePow({ ...proof, expiresInMs: Math.max(1, deadline - performance.now()) }, options.workerUrl ?? new URL("pow-worker.js", assets).href, signal);
        if (signal.aborted) throw abortError();
        prepared = { pow: { prefix: proof.prefix, nonce }, deadline };
        return prepared.pow;
      })();
      proofTask = job;
      void job.finally(() => {
        if (proofTask === job) proofTask = null;
      }).catch(() => {
      });
      return job;
    }
    function releaseChallenge(id) {
      if (id) void request("/cancel", { id }, AbortSignal.timeout(3e3)).catch(() => {
      });
    }
    function puzzle(challenge, signal) {
      return new Promise((resolve, reject) => {
        if (!challenge || !/^[a-f0-9]{32}$/.test(challenge.id) || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(challenge.image)) {
          reject(new CaptchaClientError("\u670D\u52A1\u7AEF\u8FD4\u56DE\u4E86\u4E0D\u6B63\u786E\u7684\u56FE\u7247\u6311\u6218"));
          return;
        }
        challengeId = challenge.id;
        const dlg = document.createElement("dialog");
        dialog = dlg;
        dlg.className = "puzzle";
        const titleId = `captcha-title-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
        dlg.setAttribute("aria-labelledby", titleId);
        const helpId = `${titleId}-help`;
        dlg.innerHTML = `<p class="puzzle-eyebrow" role="status">\u8BF7\u8FDB\u884C\u5B89\u5168\u9A8C\u8BC1</p><h3 id="${titleId}" tabindex="-1">\u62D6\u52A8\u6ED1\u5757, \u4F7F\u56FE\u7247\u65B9\u5411\u4E3A<strong>\u6B63</strong></h3>
        <div class="stage" tabindex="0" role="slider" aria-label="\u65CB\u8F6C\u56FE\u7247" aria-describedby="${helpId}" aria-valuemin="0" aria-valuemax="359" aria-valuenow="0" aria-valuetext="0 \u5EA6">
          <img alt="\u65CB\u8F6C\u9A8C\u8BC1\u56FE\u7247" draggable="false"><span class="stage-spinner" aria-hidden="true"></span>
          <span class="stage-result" aria-hidden="true"><svg viewBox="0 0 64 64"><path class="stage-check" pathLength="1" d="M16 33 28 45 49 21"/><path class="stage-cross" pathLength="1" d="m22 22 20 20 m0-20-20 20"/></svg></span>
        </div><input class="range" type="range" min="0" max="359" step="1" value="0" aria-label="\u65CB\u8F6C\u56FE\u7247\u89D2\u5EA6" aria-describedby="${helpId}"><p id="${helpId}" class="sr-only">\u62D6\u52A8\u6ED1\u5757\uFF0C\u677E\u5F00\u540E\u9A8C\u8BC1\u3002\u4E5F\u53EF\u7528\u65B9\u5411\u952E\u5FAE\u8C03\uFF0C\u6309 Enter \u786E\u8BA4\uFF1B\u6309 Escape \u6216\u70B9\u51FB\u5F39\u7A97\u5916\u53D6\u6D88\u3002</p><div class="error-text" role="alert"></div><button type="button" class="puzzle-cancel" data-cancel aria-label="\u53D6\u6D88\u9A8C\u8BC1">\u53D6\u6D88</button>`;
        root.append(dlg);
        const stage = dlg.querySelector(".stage"), img = dlg.querySelector("img"), range = dlg.querySelector(".range"), eyebrow = dlg.querySelector(".puzzle-eyebrow"), errEl = dlg.querySelector(".error-text");
        img.src = challenge.image;
        let deg = 0, drag = null, settled = false, submitting = false, keyboardAdjusting = false, rangeCancelled = false;
        const events = new AbortController();
        const listen = (el, type, fn) => el.addEventListener(type, fn, { signal: events.signal });
        const finish = (value, error) => {
          if (settled) return;
          settled = true;
          events.abort();
          signal.removeEventListener("abort", aborted);
          clearTimeout(challengeTimer);
          cancelPuzzle = null;
          dialog = null;
          if (challengeId === challenge.id) challengeId = null;
          if (!value) releaseChallenge(challenge.id);
          for (const animation of dlg.getAnimations?.({ subtree: true }) ?? []) animation.cancel();
          if (dlg.open) dlg.close();
          dlg.remove();
          error ? reject(error) : resolve(value);
        };
        const aborted = () => finish(null, abortError());
        const challengeTimer = setTimeout(() => finish(null, new CaptchaClientError("\u56FE\u7247\u6311\u6218\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u9A8C\u8BC1", "CHALLENGE_EXPIRED")), Math.max(1, challenge.expiresInMs));
        cancelPuzzle = () => finish(null);
        signal.addEventListener("abort", aborted, { once: true });
        function paint(value) {
          if (settled || submitting) return;
          deg = (value % 360 + 360) % 360;
          img.style.transform = `rotate(${deg}deg)`;
          range.value = String(Math.round(deg) % 360);
          range.setAttribute("aria-valuetext", `${Math.round(deg) % 360} \u5EA6`);
          stage.setAttribute("aria-valuenow", String(Math.round(deg) % 360));
          stage.setAttribute("aria-valuetext", `${Math.round(deg) % 360} \u5EA6`);
          errEl.textContent = "";
          dlg.classList.remove("has-error");
        }
        async function submit() {
          if (submitting || settled || signal.aborted) return;
          submitting = true;
          range.disabled = true;
          errEl.textContent = "";
          const checkingSince = performance.now(), feedbackMs = motion() ? 560 : 300, exitMs = motion() ? 160 : 0;
          dlg.classList.remove("has-error");
          dlg.setAttribute("aria-busy", "true");
          stage.setAttribute("aria-disabled", "true");
          stage.dataset.phase = "loading";
          eyebrow.textContent = "\u6B63\u5728\u9A8C\u8BC1\u2026";
          let result = null, failure = null;
          try {
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                result = prepareToken(await request("/challenge", { id: challenge.id, angle: Math.round(deg) % 360, pointer: tracking.getHints().pointer }, events.signal));
                break;
              } catch (error) {
                if (attempt === 0 && error.code === "TOO_FAST" && Number.isFinite(error.retryAfterMs) && error.retryAfterMs > 0) {
                  await delay(error.retryAfterMs + 25, events.signal);
                  continue;
                }
                throw error;
              }
            }
          } catch (error) {
            failure = error;
          }
          if (settled) return;
          clearTimeout(challengeTimer);
          try {
            await delay(Math.max(0, 500 - (performance.now() - checkingSince)), events.signal);
            if (result && result.tokenExpiresAt <= performance.now() + feedbackMs + exitMs) {
              result = null;
              failure = new CaptchaClientError("\u4EE4\u724C\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u9A8C\u8BC1", "TOKEN_EXPIRED");
            }
            stage.dataset.phase = failure ? "failure" : "success";
            dlg.removeAttribute("aria-busy");
            eyebrow.textContent = failure ? "\u9A8C\u8BC1\u5931\u8D25" : "\u9A8C\u8BC1\u901A\u8FC7";
            if (failure) {
              errEl.textContent = failure.message;
              dlg.classList.add("has-error");
            }
            const drawing = dlg.querySelector(failure ? ".stage-cross" : ".stage-check").getAnimations?.() ?? [];
            await Promise.allSettled(drawing.map((animation) => animation.finished));
            if (settled) return;
            await delay(drawing.length ? 180 : motion() ? feedbackMs : 300, events.signal);
            dlg.classList.add("is-closing");
            const exiting = dlg.getAnimations?.() ?? [];
            if (exiting.length) await Promise.allSettled(exiting.map((animation) => animation.finished));
            else await delay(exitMs, events.signal);
            if (!settled) finish(result, failure);
          } catch (error) {
            if (!settled) finish(null, error);
          }
        }
        const angleOf = (e) => {
          const r = stage.getBoundingClientRect();
          return Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2) * 180 / Math.PI;
        };
        listen(range, "input", () => paint(Number(range.value)));
        listen(range, "pointerdown", () => {
          keyboardAdjusting = false;
          rangeCancelled = false;
        });
        listen(range, "pointercancel", () => {
          rangeCancelled = true;
        });
        listen(range, "change", () => {
          if (!keyboardAdjusting && !rangeCancelled) void submit();
        });
        listen(range, "keydown", (e) => {
          if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(e.key)) keyboardAdjusting = true;
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        });
        listen(stage, "keydown", (e) => {
          if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
            e.preventDefault();
            paint(deg + (e.key === "ArrowLeft" ? -15 : 15));
          }
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        });
        listen(stage, "pointerdown", (e) => {
          if (e.button !== 0 || submitting) return;
          drag = { offset: angleOf(e) - deg, pointer: e.pointerId, moved: false };
          stage.setPointerCapture(e.pointerId);
          stage.classList.add("dragging");
          e.preventDefault();
        });
        listen(stage, "pointermove", (e) => {
          if (drag && e.pointerId === drag.pointer) {
            drag.moved = true;
            paint(angleOf(e) - drag.offset);
          }
        });
        listen(stage, "pointerup", (e) => {
          if (!drag || e.pointerId !== drag.pointer) return;
          const moved = drag.moved;
          drag = null;
          stage.classList.remove("dragging");
          if (moved) void submit();
        });
        for (const event of ["pointercancel", "lostpointercapture"]) listen(stage, event, () => {
          drag = null;
          stage.classList.remove("dragging");
        });
        listen(dlg.querySelector("[data-cancel]"), "click", () => finish(null));
        listen(dlg, "cancel", (e) => {
          e.preventDefault();
          finish(null);
        });
        listen(dlg, "close", () => finish(null));
        listen(dlg, "click", (e) => {
          if (e.target === dlg) {
            const r = dlg.getBoundingClientRect();
            if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) finish(null);
          }
        });
        try {
          dlg.showModal();
          dlg.querySelector("h3").focus({ preventScroll: true });
        } catch (err) {
          finish(null, err);
        }
      });
    }
    function reset() {
      if (destroyed) return;
      controller.abort();
      cancelPuzzle?.();
      controller = new AbortController();
      clearTimeout(expiryTimer);
      expiryTimer = null;
      token = null;
      expiresAt = 0;
      prepared = null;
      proofTask = null;
      task = null;
      state("idle", "\u6211\u4E0D\u662F\u673A\u5668\u4EBA");
    }
    function getToken() {
      if (token && performance.now() >= expiresAt) {
        reset();
        notify("onExpire");
      }
      return token;
    }
    function verify() {
      if (destroyed) return Promise.reject(new CaptchaClientError("\u7EC4\u4EF6\u5DF2\u9500\u6BC1", "DESTROYED"));
      if (getToken()) return Promise.resolve(token);
      if (task) return task;
      const signal = controller.signal;
      const job = (async () => {
        state("loading", "\u6B63\u5728\u9A8C\u8BC1");
        try {
          const pow = await prepareProof();
          prepared = null;
          let result = await request("/verify", { pow, trajectory: tracking.getTrajectory(), formBehavior: tracking.getFormBehavior(), hints: tracking.getHints() }, signal);
          if (signal.aborted) throw abortError();
          result = result.challenge ? await puzzle(result.challenge, signal) : prepareToken(result);
          if (!result) {
            state("idle", "\u6211\u4E0D\u662F\u673A\u5668\u4EBA");
            return null;
          }
          const until = result.tokenExpiresAt;
          await delay(Math.max(0, result.tokenUsableAt - performance.now()), signal);
          if (until <= performance.now()) throw new CaptchaClientError("\u4EE4\u724C\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u9A8C\u8BC1", "TOKEN_EXPIRED");
          token = result.token;
          expiresAt = until;
          expiryTimer = setTimeout(() => {
            reset();
            notify("onExpire");
          }, Math.max(1, until - performance.now()));
          state("verified", "\u9A8C\u8BC1\u901A\u8FC7");
          notify("onSuccess", result.token);
          return result.token;
        } catch (error) {
          if (!signal.aborted) {
            state("error", "\u9A8C\u8BC1\u5931\u8D25\uFF0C\u70B9\u51FB\u91CD\u8BD5", error.message);
            notify("onError", error);
          }
          throw error;
        }
      })();
      task = job;
      void job.finally(() => {
        if (task === job) task = null;
      }).catch(() => {
      });
      return job;
    }
    button.addEventListener("click", (e) => {
      if (motion() && !button.classList.contains("verified")) {
        const ripple = document.createElement("span");
        ripple.className = "ripple";
        const r = button.getBoundingClientRect();
        ripple.style.left = `${e.clientX ? e.clientX - r.left : r.width / 2}px`;
        ripple.style.top = `${e.clientY ? e.clientY - r.top : r.height / 2}px`;
        button.append(ripple);
        ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
      }
      void verify().catch(() => {
      });
    }, { signal: lifetime.signal });
    if (options.prewarm !== false) void prepareProof().catch(() => {
    });
    return { verify, getToken, reset, destroy() {
      if (destroyed) return;
      reset();
      destroyed = true;
      lifetime.abort();
      tracking.cleanup();
      dialog?.remove();
      host.remove();
      notify("onStateChange", "destroyed");
    } };
  }
  var Captcha = { render };
  var index_default = Captcha;
  return __toCommonJS(index_exports);
})();
