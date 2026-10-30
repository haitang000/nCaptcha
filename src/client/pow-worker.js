import { sha256Hex, powPasses } from './hash.js';
self.onmessage = ({ data: { prefix, bits } }) => {
  for (let nonce = 0; nonce <= 0x7fffffff; nonce++) {
    if (powPasses(sha256Hex(prefix + nonce), bits)) { self.postMessage({ nonce: String(nonce) }); return; }
  }
  self.postMessage({ error: '验证计算超时' });
};
