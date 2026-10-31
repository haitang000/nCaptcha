import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createDurableStore } from '../workers/store.js';

function storageFixture() {
  const database = new DatabaseSync(':memory:');
  let alarm = null;
  const alarmCalls = { set: [], deleted: 0 };
  return {
    alarmCalls,
    sql: { exec(query, ...bindings) { const rows = database.prepare(query).all(...bindings); return { toArray: () => rows }; } },
    transactionSync(fn) {
      database.exec('BEGIN');
      try { const result = fn(); database.exec('COMMIT'); return result; }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    },
    async getAlarm() { return alarm; },
    async setAlarm(value) { alarmCalls.set.push(value); alarm = value; },
    async deleteAlarm() { alarmCalls.deleted++; alarm = null; },
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
  await reopened.scheduleCleanup(); assert.deepEqual(storage.alarmCalls.set, [11000, 11000]);
  time = 11000; await reopened.cleanup(); assert.equal(await reopened.get('proof'), undefined);
  assert.equal(await storage.getAlarm(), null);
});

test('alarm 相同时间与空状态去重，最早有效期变化和触发后重新排程', async t => {
  const storage = storageFixture(); t.after(() => storage.close());
  let time = 10000;
  const store = createDurableStore(storage, { now: () => time });
  await store.set('later', 1, 5000); await store.scheduleCleanup();
  await Promise.all(Array.from({ length: 5 }, () => store.scheduleCleanup()));
  assert.deepEqual(storage.alarmCalls.set, [15000]);
  await store.set('earlier', 1, 2000); await store.scheduleCleanup();
  assert.equal(await storage.getAlarm(), 12000);
  await store.delete('earlier'); await store.scheduleCleanup();
  assert.deepEqual(storage.alarmCalls.set, [15000, 12000, 15000]);
  // 模拟 alarm 触发后清理失败、平台重试：相同目标也必须重新排程。
  await store.cleanup(); assert.equal(storage.alarmCalls.set.length, 4);
  time = 15000; await store.cleanup();
  assert.equal(await store.get('later'), undefined);
  await store.scheduleCleanup(); await store.scheduleCleanup();
  assert.equal(storage.alarmCalls.deleted, 1);
});

test('alarm 排程失败不会缓存成功，并发等待同次排程且不覆盖更新的时间', async t => {
  const storage = storageFixture(); t.after(() => storage.close());
  const store = createDurableStore(storage, { now: () => 10000 });
  await store.set('later', 1, 5000);
  const setAlarm = storage.setAlarm;
  let rejectFirst;
  storage.setAlarm = () => new Promise((_, reject) => { rejectFirst = reject; });
  const failed = [store.scheduleCleanup(), store.scheduleCleanup()];
  rejectFirst(new Error('set failed'));
  assert.ok((await Promise.allSettled(failed)).every(result => result.status === 'rejected'));
  storage.setAlarm = setAlarm;
  await store.scheduleCleanup(); assert.equal(await storage.getAlarm(), 15000);

  // 较早的一次异步失败，不能清除后来已经成功排程的缓存。
  await store.set('earlier', 1, 2000);
  storage.setAlarm = () => new Promise((_, reject) => { rejectFirst = reject; });
  const old = store.scheduleCleanup();
  await store.set('earliest', 1, 1000);
  storage.setAlarm = setAlarm;
  await store.scheduleCleanup();
  rejectFirst(new Error('old failed')); await assert.rejects(old, /old failed/);
  const calls = storage.alarmCalls.set.length;
  await store.scheduleCleanup(); assert.equal(storage.alarmCalls.set.length, calls);
  assert.equal(await storage.getAlarm(), 11000);

  await store.delete('later'); await store.delete('earlier'); await store.delete('earliest');
  const deleteAlarm = storage.deleteAlarm;
  storage.deleteAlarm = () => { throw new Error('delete failed'); };
  await assert.rejects(store.scheduleCleanup(), /delete failed/);
  storage.deleteAlarm = deleteAlarm;
  await store.scheduleCleanup(); assert.equal(await storage.getAlarm(), null);
});
