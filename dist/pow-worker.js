(() => {
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

  // src/client/pow-worker.js
  self.onmessage = ({ data: { prefix, bits } }) => {
    const passes = createPowChecker(prefix, bits);
    for (let nonce = 0; nonce <= 2147483647; nonce++) {
      if (passes(nonce)) {
        self.postMessage({ nonce: String(nonce) });
        return;
      }
    }
    self.postMessage({ error: "\u9A8C\u8BC1\u8BA1\u7B97\u8D85\u65F6" });
  };
})();
