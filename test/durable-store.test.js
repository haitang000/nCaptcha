import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createDurableStore } from '../workers/store.js';

function storageFixture() {
  const database = new DatabaseSync(':memory:');
  let alarm = null;
  return {
    sql: { exec(query, ...bindings) { const rows = database.prepare(query).all(...bindings); return { toArray: () => rows }; } },
    transactionSync(fn) {
      database.exec('BEGIN');
      try { const result = fn(); database.exec('COMMIT'); return result; }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    },
    async getAlarm() { return alarm; }, async setAlarm(value) { alarm = value; }, async deleteAlarm() { alarm = null; },
    close() { database.close(); },
  };
}
test('SQLite 存储原子修改、事务回滚、TTL 及容量限制', async t => {
  const storage = storageFixture(); t.after(() => storage.close());
  let time = 10000;
  const store = createDurableStore(storage, { now: () => time, maxEntries: 2 });
  await store.set('token', { n: 1 }, 1000);
  const result = await Promise.all(Array.from({ length: 20 }, () => store.update('token', record => ({ result: !!record }))));
  assert.equal(result.filter(Boolean).length, 1);
  await store.set('a', 1, 1000);
  await assert.rejects(store.update('a', () => { throw new Error('rollback'); }), /rollback/);
  assert.equal(await store.get('a'), 1);
  await store.set('b', 2, 1000);
  await assert.rejects(store.set('c', 3, 1000), error => error.code === 'STORE_FULL');
  time += 1000; assert.equal(await store.get('a'), undefined);
  await store.set('c', 3, 1000); assert.equal(await store.get('c'), 3);
});
test('SQLite 存储重建后读取同一持久状态；alarm 清理到期数据', async t => {
  const storage = storageFixture(); t.after(() => storage.close());
  let time = 10000;
  const store = createDurableStore(storage, { now: () => time });
  await store.set('proof', { nonce: 1 }, 1000);
  await store.scheduleCleanup(); assert.equal(await storage.getAlarm(), 11000);
  const reopened = createDurableStore(storage, { now: () => time });
  assert.deepEqual(await reopened.get('proof'), { nonce: 1 });
  time = 11000; await reopened.cleanup(); assert.equal(await reopened.get('proof'), undefined);
  assert.equal(await storage.getAlarm(), null);
});
