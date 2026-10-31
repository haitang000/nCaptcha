import { createPowChecker } from './hash.js';
self.onmessage = ({ data: { prefix, bits } }) => {
  const passes = createPowChecker(prefix, bits);
  for (let nonce = 0; nonce <= 0x7fffffff; nonce++) {
    if (passes(nonce)) { self.postMessage({ nonce: String(nonce) }); return; }
  }
  self.postMessage({ error: '验证计算超时' });
};
