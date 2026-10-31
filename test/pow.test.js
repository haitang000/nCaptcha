import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createPowChecker, sha256Hex } from '../src/client/hash.js';
import { solvePow } from '../src/client/pow.js';

const prefix = '0123456789abcdef0123456789abcdef';
const nativePasses = (prefix, nonce, bits) => crypto.createHash('sha256').update(prefix + nonce).digest().readUInt32BE(0) < 2 ** (32 - bits);

test('PoW 优化与原生 SHA-256 在所有难度、十进制进位和消息块边界上一致', () => {
  const nonces = [0, 1, 8, 9, 10, 11, 99, 100, 999, 1000, 999999999, 1000000000, 0x7fffffff, 9, 0];
  // 45 字节前缀 + 十位 nonce 恰好填满一个 SHA-256 块；46 字节起走通用路径。
  for (const text of ['', prefix, 'x'.repeat(45), 'x'.repeat(46), '中文'.repeat(7) + 'abc', '中'.repeat(43)]) {
    for (let bits = 0; bits <= 28; bits++) {
      const passes = createPowChecker(text, bits);
      for (const nonce of nonces) assert.equal(passes(nonce), nativePasses(text, nonce, bits), `${text.length}/${nonce}/${bits}`);
    }
  }
  // 覆盖连续递增时的缓冲区复用，并确保有命中与不命中两种结果。
  const passes = createPowChecker(prefix, 8);
  let successes = 0;
  for (let nonce = 0; nonce < 4096; nonce++) {
    const expected = nativePasses(prefix, nonce, 8);
    assert.equal(passes(nonce), expected);
    successes += expected;
  }
  assert.ok(successes > 0 && successes < 4096);
});

test('通用 SHA-256 保持正确，覆盖填充边界、多字节和多块消息', () => {
  for (const length of [0, 1, 55, 56, 63, 64, 119, 120, 1000]) {
    for (const text of ['x'.repeat(length), '中文'.repeat(length)]) {
      assert.equal(sha256Hex(text), crypto.createHash('sha256').update(text).digest('hex'));
    }
  }
});

test('无 Worker 回退仍返回原生算法接受的最小 nonce', async () => {
  assert.equal(typeof globalThis.Worker, 'undefined');
  const nonce = await solvePow({ prefix, bits: 12, expiresInMs: 10000 }, '/unused-worker.js', new AbortController().signal);
  assert.equal(nativePasses(prefix, nonce, 12), true);
  for (let value = 0; value < Number(nonce); value++) assert.equal(nativePasses(prefix, value, 12), false);
});

test('主线程回退计算中可取消，零难度和非法输入保持原有行为', async () => {
  assert.equal(typeof globalThis.Worker, 'undefined');
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 0);
  await assert.rejects(solvePow({ prefix, bits: 28, expiresInMs: 10000 }, '/unused-worker.js', controller.signal), { name: 'AbortError' });
  const signal = new AbortController().signal;
  assert.equal(await solvePow({ prefix: '', bits: 0, expiresInMs: 1000 }, '/unused-worker.js', signal), '0');
  for (const bits of [-1, 29, NaN, 1.5]) await assert.rejects(solvePow({ prefix, bits, expiresInMs: 1000 }, '/unused-worker.js', signal), /PoW 参数/);
  await assert.rejects(solvePow({ prefix, bits: 12, expiresInMs: 1000 }, '/unused-worker.js', AbortSignal.abort()), { name: 'AbortError' });
});
