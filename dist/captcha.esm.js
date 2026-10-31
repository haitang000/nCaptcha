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

// src/client/logo.svg
var logo_default = 'data:image/svg+xml,<svg viewBox="0 0 99 20" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="99.000000" height="20.000000" fill="none" customFrame="%23000000">%0A%09<defs>%0A%09%09<clipPath id="clipPath_0">%0A%09%09%09<rect width="20.000000" height="20.000000" x="0.000000" y="0.000000" fill="rgb(255,255,255)" />%0A%09%09</clipPath>%0A%09</defs>%0A%09<g id="\u7EC4\u5408 17">%0A%09%09<path id="" d="M22.6016 15.1719L22.6016 4.32812C22.6016 4.21354 22.6224 4.10547 22.6641 4.00391C22.7057 3.90234 22.7643 3.8138 22.8398 3.73828C22.9154 3.66276 23.0026 3.60417 23.1016 3.5625C23.2005 3.52083 23.3099 3.5 23.4297 3.5C23.6745 3.5 23.888 3.60156 24.0703 3.80469L31.0391 12.7656L31.0391 4.32812C31.0391 4.09896 31.1198 3.90365 31.2812 3.74219C31.4427 3.58073 31.638 3.5 31.8672 3.5C32.0964 3.5 32.2917 3.58073 32.4531 3.74219C32.6146 3.90365 32.6953 4.09896 32.6953 4.32812L32.6953 15.1719C32.6953 15.2917 32.6745 15.401 32.6328 15.5C32.5911 15.599 32.5326 15.6862 32.457 15.7617C32.3815 15.8372 32.293 15.8958 32.1914 15.9375C32.0898 15.9792 31.9818 16 31.8672 16C31.6224 16 31.4115 15.9036 31.2344 15.7109L24.2578 6.75L24.2578 15.1719C24.2578 15.401 24.1771 15.5964 24.0156 15.7578C23.8542 15.9193 23.6589 16 23.4297 16C23.2005 16 23.0052 15.9193 22.8438 15.7578C22.6823 15.5964 22.6016 15.401 22.6016 15.1719ZM43.4688 13.1875C43.5833 13.1875 43.6901 13.2096 43.7891 13.2539C43.888 13.2982 43.9753 13.3568 44.0508 13.4297C44.1263 13.5026 44.1862 13.5898 44.2305 13.6914C44.2747 13.793 44.2969 13.901 44.2969 14.0156C44.2969 14.2344 44.2109 14.4323 44.0391 14.6094C42.8776 15.5365 41.5677 16 40.1094 16C38.3802 16 36.9062 15.3906 35.6875 14.1719C34.4688 12.9531 33.8594 11.4792 33.8594 9.75C33.8594 8.02604 34.4688 6.55469 35.6875 5.33594C36.9115 4.11198 38.3854 3.5 40.1094 3.5C41.5885 3.5 42.9245 3.98698 44.1172 4.96094C44.263 5.10156 44.3359 5.29167 44.3359 5.53125C44.3359 5.65104 44.3151 5.76042 44.2734 5.85938C44.2318 5.95833 44.1732 6.04557 44.0977 6.12109C44.0221 6.19661 43.9336 6.25521 43.832 6.29688C43.7305 6.33854 43.6224 6.35938 43.5078 6.35938C43.3047 6.35938 43.1146 6.28125 42.9375 6.125C42.5417 5.8125 42.1055 5.57292 41.6289 5.40625C41.1523 5.23958 40.6458 5.15625 40.1094 5.15625C38.8385 5.15625 37.7526 5.60677 36.8516 6.50781C35.9609 7.39844 35.5156 8.47917 35.5156 9.75C35.5156 11.026 35.9609 12.1094 36.8516 13C37.7474 13.8958 38.8333 14.3438 40.1094 14.3438C41.1979 14.3438 42.1562 14.0078 42.9844 13.3359C43.1198 13.2422 43.2812 13.1927 43.4688 13.1875ZM49.8125 8.88281C49.4271 8.88281 49.0677 8.95573 48.7344 9.10156C48.401 9.2474 48.112 9.44401 47.8672 9.69141C47.6224 9.9388 47.4284 10.2292 47.2852 10.5625C47.1419 10.8958 47.0703 11.25 47.0703 11.625C47.0703 12 47.1419 12.3542 47.2852 12.6875C47.4284 13.0208 47.6224 13.3112 47.8672 13.5586C48.112 13.806 48.401 14.0026 48.7344 14.1484C49.0677 14.2943 49.4271 14.3672 49.8125 14.3672C50.1927 14.3672 50.5495 14.2943 50.8828 14.1484C51.2161 14.0026 51.5065 13.8047 51.7539 13.5547C52.0013 13.3047 52.1966 13.0143 52.3398 12.6836C52.4831 12.3529 52.5547 12 52.5547 11.625C52.5547 11.25 52.4831 10.8971 52.3398 10.5664C52.1966 10.2357 52.0013 9.94531 51.7539 9.69531C51.5065 9.44531 51.2161 9.2474 50.8828 9.10156C50.5495 8.95573 50.1927 8.88281 49.8125 8.88281ZM52.5547 15.1875L52.5547 15.0312C52.1641 15.3438 51.7396 15.5833 51.2812 15.75C50.8229 15.9167 50.3333 16 49.8125 16C48.6042 16 47.5729 15.5729 46.7188 14.7188C45.8646 13.8646 45.4375 12.8333 45.4375 11.625C45.4375 10.4167 45.8646 9.38542 46.7188 8.53125C47.5729 7.67708 48.6042 7.25 49.8125 7.25C51.0104 7.25 52.0417 7.67708 52.9062 8.53125C53.7604 9.38542 54.1875 10.4167 54.1875 11.625L54.1875 15.1875C54.1875 15.4115 54.1081 15.6029 53.9492 15.7617C53.7904 15.9206 53.599 16 53.375 16C53.1458 16 52.9518 15.9206 52.793 15.7617C52.6341 15.6029 52.5547 15.4115 52.5547 15.1875ZM57.0703 11.625C57.0703 12 57.1419 12.3542 57.2852 12.6875C57.4284 13.0208 57.6224 13.3112 57.8672 13.5586C58.112 13.806 58.401 14.0026 58.7344 14.1484C59.0677 14.2943 59.4271 14.3672 59.8125 14.3672C60.1927 14.3672 60.5495 14.2943 60.8828 14.1484C61.2161 14.0026 61.5065 13.8047 61.7539 13.5547C62.0013 13.3047 62.1966 13.0143 62.3398 12.6836C62.4831 12.3529 62.5547 12 62.5547 11.625C62.5547 11.25 62.4831 10.8971 62.3398 10.5664C62.1966 10.2357 62.0013 9.94531 61.7539 9.69531C61.5065 9.44531 61.2161 9.2474 60.8828 9.10156C60.5495 8.95573 60.1927 8.88281 59.8125 8.88281C59.4271 8.88281 59.0677 8.95573 58.7344 9.10156C58.401 9.2474 58.112 9.44401 57.8672 9.69141C57.6224 9.9388 57.4284 10.2292 57.2852 10.5625C57.1419 10.8958 57.0703 11.25 57.0703 11.625ZM59.8125 16C58.7656 16 57.8516 15.6797 57.0703 15.0391L57.0703 18.9375C57.0703 19.1719 56.9909 19.3659 56.832 19.5195C56.6732 19.6732 56.4792 19.75 56.25 19.75C56.0156 19.75 55.8216 19.6732 55.668 19.5195C55.5143 19.3659 55.4375 19.1719 55.4375 18.9375L55.4375 11.625C55.4375 10.4167 55.8646 9.38542 56.7188 8.53125C57.5729 7.67708 58.6042 7.25 59.8125 7.25C61.0104 7.25 62.0417 7.67708 62.9062 8.53125C63.3333 8.95312 63.6536 9.42318 63.8672 9.94141C64.0807 10.4596 64.1875 11.0208 64.1875 11.625C64.1875 12.8438 63.7604 13.875 62.9062 14.7188C62.4688 15.151 61.9935 15.4727 61.4805 15.6836C60.9674 15.8945 60.4115 16 59.8125 16ZM66.2031 7.25L66.5703 7.25L66.5703 4.3125C66.5703 4.08854 66.6497 3.89714 66.8086 3.73828C66.9675 3.57943 67.1615 3.5 67.3906 3.5C67.6146 3.5 67.806 3.57943 67.9648 3.73828C68.1237 3.89714 68.2031 4.08854 68.2031 4.3125L68.2031 7.25L69.1797 7.25C69.4036 7.25 69.5938 7.32943 69.75 7.48828C69.9062 7.64714 69.9844 7.83854 69.9844 8.0625C69.9844 8.29167 69.9062 8.48568 69.75 8.64453C69.5938 8.80338 69.4036 8.88281 69.1797 8.88281L68.2031 8.88281L68.2031 12.8125C68.2031 13.849 68.724 14.3672 69.7656 14.3672C69.9896 14.3672 70.1797 14.4466 70.3359 14.6055C70.4922 14.7643 70.5703 14.9557 70.5703 15.1797C70.5703 15.4089 70.4922 15.6029 70.3359 15.7617C70.1797 15.9206 69.9896 16 69.7656 16C67.6354 16 66.5703 14.9375 66.5703 12.8125L66.5703 8.88281L66.2031 8.88281C65.9844 8.88281 65.7956 8.80338 65.6367 8.64453C65.4779 8.48568 65.3984 8.29167 65.3984 8.0625C65.3984 7.83854 65.4779 7.64714 65.6367 7.48828C65.7956 7.32943 65.9844 7.25 66.2031 7.25ZM77.8828 13.5234C78.1172 13.5234 78.3112 13.6003 78.4648 13.7539C78.6185 13.9076 78.6953 14.1016 78.6953 14.3359C78.6953 14.5651 78.6094 14.7656 78.4375 14.9375C77.6302 15.6458 76.6797 16 75.5859 16C74.3776 16 73.3464 15.5729 72.4922 14.7188C71.638 13.8646 71.2109 12.8333 71.2109 11.625C71.2109 10.4167 71.638 9.38542 72.4922 8.53125C73.3464 7.67708 74.3776 7.25 75.5859 7.25C76.6849 7.25 77.6354 7.60417 78.4375 8.3125C78.625 8.47917 78.7188 8.6849 78.7188 8.92969C78.7188 9.16406 78.6419 9.35938 78.4883 9.51562C78.3346 9.67188 78.1406 9.75 77.9062 9.75C77.7083 9.75 77.5312 9.6875 77.375 9.5625C77.1094 9.33854 76.8307 9.16927 76.5391 9.05469C76.2474 8.9401 75.9297 8.88281 75.5859 8.88281C75.2057 8.88281 74.849 8.95443 74.5156 9.09766C74.1823 9.24088 73.8906 9.4362 73.6406 9.68359C73.3906 9.93099 73.194 10.2214 73.0508 10.5547C72.9075 10.888 72.8359 11.2448 72.8359 11.625C72.8359 12.0052 72.9075 12.362 73.0508 12.6953C73.194 13.0286 73.3906 13.319 73.6406 13.5664C73.8906 13.8138 74.1823 14.0091 74.5156 14.1523C74.849 14.2956 75.2057 14.3672 75.5859 14.3672C75.9297 14.3672 76.2474 14.3112 76.5391 14.1992C76.8307 14.0872 77.1068 13.9193 77.3672 13.6953C77.513 13.5859 77.6849 13.5286 77.8828 13.5234ZM81.6016 15.1797C81.6016 15.4089 81.5221 15.6029 81.3633 15.7617C81.2044 15.9206 81.0104 16 80.7812 16C80.5573 16 80.3659 15.9206 80.207 15.7617C80.0482 15.6029 79.9688 15.4089 79.9688 15.1797L79.9688 4.32031C79.9688 4.09115 80.0482 3.89714 80.207 3.73828C80.3659 3.57943 80.5573 3.5 80.7812 3.5C81.0052 3.5 81.1966 3.57943 81.3555 3.73828C81.5143 3.89714 81.5964 4.09115 81.6016 4.32031L81.6016 8.07031C82.2943 7.53385 83.1094 7.26562 84.0469 7.26562C84.5938 7.26562 85.1133 7.3724 85.6055 7.58594C86.0977 7.79948 86.5312 8.08984 86.9062 8.45703C87.2812 8.82422 87.5781 9.25651 87.7969 9.75391C88.0156 10.2513 88.125 10.7812 88.125 11.3438L88.125 15.1797C88.1198 15.4089 88.0378 15.6029 87.8789 15.7617C87.7201 15.9206 87.5286 16 87.3047 16C87.0807 16 86.8893 15.9206 86.7305 15.7617C86.5716 15.6029 86.4922 15.4089 86.4922 15.1797L86.4922 11.3438C86.4922 11.0104 86.4271 10.6953 86.2969 10.3984C86.1667 10.1016 85.9909 9.84245 85.7695 9.62109C85.5482 9.39974 85.2891 9.22396 84.9922 9.09375C84.6953 8.96354 84.3802 8.89844 84.0469 8.89844C83.7083 8.89844 83.3919 8.96224 83.0977 9.08984C82.8034 9.21745 82.5443 9.39323 82.3203 9.61719C82.0964 9.84115 81.9206 10.1016 81.793 10.3984C81.6654 10.6953 81.6016 11.0104 81.6016 11.3438L81.6016 15.1797ZM93.7266 8.88281C93.3411 8.88281 92.9818 8.95573 92.6484 9.10156C92.3151 9.2474 92.026 9.44401 91.7812 9.69141C91.5365 9.9388 91.3424 10.2292 91.1992 10.5625C91.056 10.8958 90.9844 11.25 90.9844 11.625C90.9844 12 91.056 12.3542 91.1992 12.6875C91.3424 13.0208 91.5365 13.3112 91.7812 13.5586C92.026 13.806 92.3151 14.0026 92.6484 14.1484C92.9818 14.2943 93.3411 14.3672 93.7266 14.3672C94.1068 14.3672 94.4635 14.2943 94.7969 14.1484C95.1302 14.0026 95.4206 13.8047 95.668 13.5547C95.9154 13.3047 96.1107 13.0143 96.2539 12.6836C96.3971 12.3529 96.4688 12 96.4688 11.625C96.4688 11.25 96.3971 10.8971 96.2539 10.5664C96.1107 10.2357 95.9154 9.94531 95.668 9.69531C95.4206 9.44531 95.1302 9.2474 94.7969 9.10156C94.4635 8.95573 94.1068 8.88281 93.7266 8.88281ZM96.4688 15.1875L96.4688 15.0312C96.0781 15.3438 95.6536 15.5833 95.1953 15.75C94.737 15.9167 94.2474 16 93.7266 16C92.5182 16 91.487 15.5729 90.6328 14.7188C89.7786 13.8646 89.3516 12.8333 89.3516 11.625C89.3516 10.4167 89.7786 9.38542 90.6328 8.53125C91.487 7.67708 92.5182 7.25 93.7266 7.25C94.9245 7.25 95.9557 7.67708 96.8203 8.53125C97.6745 9.38542 98.1016 10.4167 98.1016 11.625L98.1016 15.1875C98.1016 15.4115 98.0221 15.6029 97.8633 15.7617C97.7044 15.9206 97.513 16 97.2891 16C97.0599 16 96.8659 15.9206 96.707 15.7617C96.5482 15.6029 96.4688 15.4115 96.4688 15.1875Z" fill="rgb(144,146,151)" fill-rule="nonzero" />%0A%09%09<g id="drag-move-line" clip-path="url(%23clipPath_0)" customFrame="url(%23clipPath_0)">%0A%09%09%09<rect id="drag-move-line" width="20.000000" height="20.000000" x="0.000000" y="0.000000" fill="rgb(255,255,255)" fill-opacity="0" />%0A%09%09%09<path id="\u77E2\u91CF 42" d="M11.4142 3.08121L12.9463 4.61329C13.2719 4.93885 13.2718 5.46671 12.9461 5.79215C12.6206 6.11747 12.0929 6.11733 11.7676 5.79184L11.1787 5.20272C10.5278 4.55161 9.47224 4.55161 8.82136 5.20272L8.23245 5.79184C7.90708 6.11733 7.37946 6.11747 7.05391 5.79215C6.72824 5.46671 6.72815 4.93885 7.0537 4.61329L8.58579 3.08121C9.36684 2.30016 10.6332 2.30016 11.4142 3.08121ZM3.08089 8.58611L4.61297 7.05402C4.93853 6.72847 5.46639 6.72856 5.79183 7.05423C6.11715 7.37978 6.11701 7.9074 5.79152 8.23277L5.2024 8.82168C4.55129 9.47256 4.55129 10.5281 5.2024 11.179L5.79152 11.7679C6.11701 12.0933 6.11715 12.6209 5.79183 12.9464C5.46639 13.2721 4.93853 13.2722 4.61297 12.9466L3.08088 11.4145C2.29984 10.6335 2.29984 9.36716 3.08089 8.58611ZM16.9191 11.4145L15.387 12.9466C15.0615 13.2722 14.5336 13.2721 14.2082 12.9464C13.8829 12.6209 13.883 12.0933 14.2085 11.7679L14.7976 11.179C15.4487 10.5281 15.4487 9.47256 14.7976 8.82168L14.2085 8.23277C13.883 7.9074 13.8829 7.37978 14.2082 7.05423C14.5336 6.72856 15.0615 6.72847 15.387 7.05402L16.9191 8.58611C17.7002 9.36716 17.7002 10.6335 16.9191 11.4145ZM10 11.667C9.558 11.667 9.13409 11.4914 8.8215 11.1788C8.50892 10.8662 8.33334 10.4423 8.33334 10.0003C8.33334 9.55832 8.50892 9.13441 8.8215 8.82183C9.13409 8.50924 9.558 8.33366 10 8.33366C10.442 8.33366 10.8659 8.50924 11.1785 8.82183C11.4911 9.13441 11.6667 9.55832 11.6667 10.0003C11.6667 10.4423 11.4911 10.8662 11.1785 11.1788C10.8659 11.4914 10.442 11.667 10 11.667ZM8.58579 16.9194L7.0537 15.3874C6.72815 15.0618 6.72824 14.5339 7.05391 14.2085C7.37946 13.8832 7.90708 13.8833 8.23245 14.2088L8.82136 14.7979C9.47224 15.449 10.5278 15.449 11.1787 14.7979L11.7676 14.2088C12.0929 13.8833 12.6206 13.8832 12.9461 14.2085C13.2718 14.5339 13.2719 15.0618 12.9463 15.3874L11.4142 16.9194C10.6332 17.7005 9.36684 17.7005 8.58579 16.9194Z" fill="rgb(144,146,151)" fill-rule="evenodd" />%0A%09%09</g>%0A%09</g>%0A</svg>%0A';

// src/client/index.js
var defaultAssets = new URL("./", import.meta.url).href;
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
  function prepareProof(signal = controller.signal) {
    if (prepared && prepared.deadline > performance.now() + 1e3) return Promise.resolve(prepared.pow);
    if (proofTask) return proofTask;
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
        <div class="stage-viewport"><div class="stage" tabindex="0" role="slider" aria-label="\u65CB\u8F6C\u56FE\u7247" aria-describedby="${helpId}" aria-valuemin="0" aria-valuemax="359" aria-valuenow="0" aria-valuetext="0 \u5EA6">
          <img alt="\u65CB\u8F6C\u9A8C\u8BC1\u56FE\u7247" draggable="false"><span class="stage-spinner" aria-hidden="true"></span>
          <span class="stage-result" aria-hidden="true"><svg viewBox="0 0 64 64"><path class="stage-check" pathLength="1" d="M16 33 28 45 49 21"/><path class="stage-cross" pathLength="1" d="m22 22 20 20 m0-20-20 20"/></svg></span>
        </div></div><div class="error-text" role="alert"></div><input class="range" type="range" min="0" max="359" step="1" value="0" aria-label="\u65CB\u8F6C\u56FE\u7247\u89D2\u5EA6" aria-describedby="${helpId}"><img class="puzzle-logo" width="99" height="20" alt="NCaptcha" draggable="false"><p id="${helpId}" class="sr-only">\u62D6\u52A8\u6ED1\u5757\uFF0C\u677E\u5F00\u540E\u9A8C\u8BC1\u3002\u4E5F\u53EF\u7528\u65B9\u5411\u952E\u5FAE\u8C03\uFF0C\u6309 Enter \u786E\u8BA4\uFF1B\u6309 Escape \u6216\u70B9\u51FB\u5F39\u7A97\u5916\u53D6\u6D88\u3002</p><button type="button" class="puzzle-cancel" data-cancel aria-label="\u53D6\u6D88\u9A8C\u8BC1">\u53D6\u6D88</button>`;
      dlg.querySelector(".puzzle-logo").src = logo_default;
      root.append(dlg);
      const viewport = dlg.querySelector(".stage-viewport"), stage = dlg.querySelector(".stage"), img = dlg.querySelector("img"), range = dlg.querySelector(".range"), eyebrow = dlg.querySelector(".puzzle-eyebrow"), errEl = dlg.querySelector(".error-text");
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
        if (challengeId === challenge.id) challengeId = null;
        if (!value) releaseChallenge(challenge.id);
        for (const animation of dlg.getAnimations?.({ subtree: true }) ?? []) animation.cancel();
        const remove = () => {
          if (dlg.open) dlg.close();
          dlg.remove();
          if (dialog === dlg) {
            dialog = null;
            cancelPuzzle = null;
          }
          error ? reject(error) : resolve(value);
        };
        if (!dlg.open) {
          remove();
          return;
        }
        dlg.inert = true;
        dlg.classList.add("is-closing");
        const exiting = dlg.getAnimations?.() ?? [];
        if (exiting.length) void Promise.allSettled(exiting.map((animation) => animation.finished)).then(remove);
        else if (motion()) setTimeout(remove, 160);
        else remove();
      };
      const aborted = () => finish(null, abortError());
      const expireChallenge = () => finish(null, new CaptchaClientError("\u56FE\u7247\u6311\u6218\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u9A8C\u8BC1", "CHALLENGE_EXPIRED"));
      let challengeTimer = setTimeout(expireChallenge, Math.max(1, challenge.expiresInMs));
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
      async function nextRound() {
        eyebrow.textContent = "\u6B63\u5728\u66F4\u6362\u56FE\u7247\u2026";
        dlg.setAttribute("aria-busy", "true");
        const [, pow] = await Promise.all([request("/cancel", { id: challenge.id }, events.signal), prepareProof(events.signal)]);
        prepared = null;
        const response = await request("/verify", { pow }, events.signal);
        const next = response.challenge;
        if (!next || !/^[a-f0-9]{32}$/.test(next.id) || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(next.image) || !Number.isFinite(next.expiresInMs) || next.expiresInMs <= 0) throw new CaptchaClientError("\u670D\u52A1\u7AEF\u8FD4\u56DE\u4E86\u4E0D\u6B63\u786E\u7684\u56FE\u7247\u6311\u6218");
        if (settled) {
          releaseChallenge(next.id);
          return;
        }
        challenge = next;
        challengeId = next.id;
        challengeTimer = setTimeout(expireChallenge, Math.max(1, next.expiresInMs - response.roundTripMs));
        const preload = new Image();
        preload.src = next.image;
        await preload.decode();
        if (settled) return;
        const outgoing = stage.cloneNode(true);
        outgoing.className = "stage-outgoing";
        outgoing.removeAttribute("tabindex");
        outgoing.removeAttribute("role");
        outgoing.setAttribute("aria-hidden", "true");
        outgoing.inert = true;
        viewport.append(outgoing);
        img.src = next.image;
        img.style.transform = "rotate(0deg)";
        deg = 0;
        range.value = "0";
        range.setAttribute("aria-valuetext", "0 \u5EA6");
        stage.setAttribute("aria-valuenow", "0");
        stage.setAttribute("aria-valuetext", "0 \u5EA6");
        stage.dataset.phase = "switching";
        errEl.textContent = "";
        dlg.classList.remove("has-error");
        const animations = [];
        try {
          if (motion() && stage.animate) {
            const distance = viewport.clientWidth, timing = { duration: 260, easing: "cubic-bezier(.65,0,.35,1)", fill: "both" };
            animations.push(outgoing.animate([{ transform: "translateX(0)" }, { transform: `translateX(-${distance}px)` }], timing));
            animations.push(stage.animate([{ transform: `translateX(${distance}px)` }, { transform: "translateX(0)" }], timing));
            await Promise.allSettled(animations.map((animation) => animation.finished));
          }
        } finally {
          for (const animation of animations) animation.cancel();
          outgoing.remove();
        }
        if (settled) return;
        submitting = false;
        keyboardAdjusting = false;
        rangeCancelled = false;
        range.disabled = false;
        stage.removeAttribute("aria-disabled");
        delete stage.dataset.phase;
        dlg.removeAttribute("aria-busy");
        eyebrow.textContent = "\u8BF7\u8FDB\u884C\u5B89\u5168\u9A8C\u8BC1";
        range.focus({ preventScroll: true });
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
          if (settled) return;
          if (failure && ["ANGLE_INCORRECT", "CHALLENGE_EXHAUSTED", "CHALLENGE_EXPIRED"].includes(failure.code)) await nextRound();
          else finish(result, failure);
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
        if (signal.aborted) throw abortError();
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
export {
  Captcha,
  CaptchaClientError,
  index_default as default,
  render
};
