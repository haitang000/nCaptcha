import { createPowChecker } from './hash.js';
export function abortError() { return new DOMException('验证已取消', 'AbortError'); }
export function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
export async function solvePow({ prefix, bits, expiresInMs }, workerUrl, signal) {
  if (!Number.isInteger(bits) || bits < 0 || bits > 28 || typeof prefix !== 'string' || prefix.length > 128 || !Number.isFinite(expiresInMs) || expiresInMs <= 0) throw new Error('服务端返回了不正确的 PoW 参数');
  if (signal.aborted) throw abortError();
  if (!bits) return '0';
  const deadline = performance.now() + expiresInMs;
  let worker;
  try {
    if (typeof Worker !== 'undefined') {
      worker = new Worker(workerUrl);
      return await new Promise((resolve, reject) => {
        const stop = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); };
        const cancel = () => { stop(); reject(abortError()); };
        const timer = setTimeout(() => { stop(); reject(new Error('验证计算超时')); }, expiresInMs);
        signal.addEventListener('abort', cancel, { once: true });
        worker.onmessage = ({ data }) => { stop(); data?.nonce != null ? resolve(data.nonce) : reject(new Error(data?.error || '验证计算失败')); };
        worker.onerror = event => { event.preventDefault(); stop(); reject(new Error('Worker 不可用')); };
        worker.postMessage({ prefix, bits });
      });
    }
  } catch (err) { if (signal.aborted) throw abortError(); }
  finally { worker?.terminate(); }
  const passes = createPowChecker(prefix, bits);
  let nonce = 0;
  while (nonce <= 0x7fffffff && performance.now() < deadline) {
    const end = Math.min(deadline, performance.now() + 8);
    do {
      // 每批检查一次时钟，保留主线程的 8ms 时间片和取消能力。
      const stop = Math.min(nonce + 128, 0x80000000);
      for (; nonce < stop; nonce++) if (passes(nonce)) return String(nonce);
    } while (nonce <= 0x7fffffff && performance.now() < end);
    await delay(0, signal);
  }
  throw new Error('验证计算超时，请重试');
}
