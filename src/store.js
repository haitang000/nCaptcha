import { CaptchaError } from './error.js';

/** update 的回调同步执行，同一个 key 的读改写不可被打断；返回值与内部对象隔离。 */
export function createMemoryStore({ now = Date.now, maxEntries = 10000, cleanupIntervalMs = 60000 } = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isInteger(cleanupIntervalMs) || cleanupIntervalMs < 0 || typeof now !== 'function') {
    throw new TypeError('内存存储配置不正确');
  }
  const records = new Map();
  let closed = false;
  const copy = value => value === undefined ? undefined : structuredClone(value);
  function sweep() {
    for (const [key, record] of records) if (record.expiresAt <= now()) records.delete(key);
  }
  function live(key) {
    if (closed) throw new CaptchaError('CLOSED', '存储已关闭', 503);
    const record = records.get(key);
    if (record && record.expiresAt <= now()) { records.delete(key); return undefined; }
    return record;
  }
  function write(key, value, ttlMs) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError('ttlMs 必须为正数');
    if (!records.has(key) && records.size >= maxEntries) {
      sweep();
      if (records.size >= maxEntries) throw new CaptchaError('STORE_FULL', '验证服务繁忙，请稍后再试', 503);
    }
    records.set(key, { value: copy(value), expiresAt: now() + ttlMs });
  }
  const timer = cleanupIntervalMs ? setInterval(sweep, cleanupIntervalMs) : null;
  timer?.unref();
  return {
    async get(key) { return copy(live(key)?.value); },
    async set(key, value, ttlMs) { live(key); write(key, value, ttlMs); },
    async delete(key) { live(key); records.delete(key); },
    async update(key, updater) {
      const change = updater(copy(live(key)?.value));
      if (!change || typeof change !== 'object' || typeof change.then === 'function') throw new TypeError('update 回调必须同步返回状态变更');
      if (change.value === undefined) records.delete(key);
      else write(key, change.value, change.ttlMs);
      return copy(change.result);
    },
    async close() { closed = true; if (timer) clearInterval(timer); records.clear(); },
  };
}
