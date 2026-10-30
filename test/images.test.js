import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { decodePng, encodePng, rotatePixels, obscurePuzzle, loadPuzzles } from '../src/images.js';
import { sha256Hex } from '../src/client/hash.js';
import { sampleTrajectory } from '../src/client/tracking.js';
import crypto from 'node:crypto';

test('四张题图完整；解码编码及随机加工仍保持尺寸', () => {
  const puzzles = loadPuzzles(new URL('../assets/puzzles/', import.meta.url));
  assert.equal(puzzles.length, 4);
  const image = obscurePuzzle(puzzles[0]);
  assert.equal(image.w, 256); assert.equal(image.h, 256);
  const bytes = encodePng(image);
  assert.deepEqual(decodePng(bytes).rgba, image.rgba);
});
function png(colorType, row) {
  // 从编码器产生合法 CRC 的分块，替换 IHDR/IDAT 后重新生成 CRC。
  const block = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = colorType;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), block('IHDR', ihdr), block('IDAT', zlib.deflateSync(Buffer.from([0, ...row]))), block('IEND', Buffer.alloc(0))]);
}
test('PNG 灰度、灰度透明、RGB 通道映射正确，拒绝截断数据', () => {
  assert.deepEqual([...decodePng(png(0, [17, 210])).rgba], [17,17,17,255,210,210,210,255]);
  assert.deepEqual([...decodePng(png(4, [17, 40, 210, 130])).rgba], [17,17,17,40,210,210,210,130]);
  assert.deepEqual([...decodePng(png(2, [1,2,3,4,5,6])).rgba], [1,2,3,255,4,5,6,255]);
  assert.throws(() => decodePng(png(0, [17, 210]).subarray(0, 40)));
});
test('真实像素旋转为顺时针，客户端需用负角度回正', () => {
  const rgba = Buffer.alloc(8 * 8 * 4);
  rgba[(1 * 8 + 4) * 4] = 255; rgba[(1 * 8 + 4) * 4 + 3] = 255;
  const rotated = rotatePixels({ w: 8, h: 8, rgba }, 90);
  assert.equal(rotated.rgba[(4 * 8 + 7) * 4], 255);
  const original = rotatePixels(rotated, -90);
  assert.equal(original.rgba[(1 * 8 + 4) * 4], 255);
});
test('浏览器 SHA-256 与 Node 一致；轨迹始终均匀限制到 100 点', () => {
  for (const text of ['', 'abc', '中文hello', 'x'.repeat(1000)]) assert.equal(sha256Hex(text), crypto.createHash('sha256').update(text).digest('hex'));
  for (const size of [5, 99, 100, 149, 151, 199, 299, 499, 999]) {
    const points = Array.from({ length: size }, (_, i) => ({ x: i, y: i, t: i * 10 + 100 }));
    const sampled = sampleTrajectory(points);
    assert.equal(sampled.length, Math.min(100, size)); assert.equal(sampled[0].t, 0); assert.equal(sampled.at(-1).x, size - 1);
  }
});
