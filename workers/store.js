import { CaptchaError } from '../src/error.js';

/** SQLite 同步事务中完成读、检查及修改，异步接口与 Node 内存存储一致。 */
export function createDurableStore(storage, { now = Date.now, maxEntries = 10000 } = {}) {
  const sql = storage.sql;
  sql.exec('CREATE TABLE IF NOT EXISTS captcha_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL)');
  sql.exec('CREATE INDEX IF NOT EXISTS captcha_expiry ON captcha_state (expires_at)');
  const sweep = () => { sql.exec('DELETE FROM captcha_state WHERE expires_at <= ?', now()); };
  function read(key) {
    const row = sql.exec('SELECT value, expires_at FROM captcha_state WHERE key = ?', key).toArray()[0];
    if (!row) return undefined;
    if (row.expires_at <= now()) { sql.exec('DELETE FROM captcha_state WHERE key = ?', key); return undefined; }
    return JSON.parse(row.value);
  }
  function write(key, value, ttlMs) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError('ttlMs 必须为正数');
    const exists = sql.exec('SELECT key FROM captcha_state WHERE key = ?', key).toArray().length;
    if (!exists && sql.exec('SELECT COUNT(*) AS count FROM captcha_state').toArray()[0].count >= maxEntries) {
      sweep();
      if (sql.exec('SELECT COUNT(*) AS count FROM captcha_state').toArray()[0].count >= maxEntries) throw new CaptchaError('STORE_FULL', '验证服务繁忙，请稍后再试', 503);
    }
    sql.exec('INSERT INTO captcha_state (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires_at=excluded.expires_at', key, JSON.stringify(value), now() + ttlMs);
  }
  return {
    async get(key) { return storage.transactionSync(() => read(key)); },
    async set(key, value, ttlMs) { storage.transactionSync(() => write(key, value, ttlMs)); },
    async delete(key) { sql.exec('DELETE FROM captcha_state WHERE key = ?', key); },
    async update(key, updater) {
      return storage.transactionSync(() => {
        const change = updater(read(key));
        if (!change || typeof change !== 'object' || typeof change.then === 'function') throw new TypeError('update 回调必须同步返回状态变更');
        if (change.value === undefined) sql.exec('DELETE FROM captcha_state WHERE key = ?', key);
        else write(key, change.value, change.ttlMs);
        return structuredClone(change.result);
      });
    },
    async scheduleCleanup() {
      const expires = sql.exec('SELECT MIN(expires_at) AS expires FROM captcha_state').toArray()[0].expires;
      if (expires === null) { await storage.deleteAlarm(); return; }
      // 查询最早到期项后立即排程，中途不 await，避免并发请求把更早的 alarm 覆盖成较晚时间。
      await storage.setAlarm(Math.max(now() + 1000, expires));
    },
    async cleanup() { sweep(); await this.scheduleCleanup(); },
  };
}
