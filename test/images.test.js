import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { decodePng, encodePng, rotatePixels, obscurePuzzle, loadPuzzles } from '../src/images.js';
import { sha256Hex } from '../src/client/hash.js';
import { sampleTrajectory } from '../src/client/tracking.js';
import crypto from 'node:crypto';

test('十张题图完整；解码编码及随机加工仍保持尺寸', () => {
  const puzzles = loadPuzzles(new URL('../assets/puzzles/', import.meta.url));
  assert.equal(puzzles.length, 10);
  for (const puzzle of puzzles) {
    const image = obscurePuzzle(puzzle);
    assert.equal(image.w, 256); assert.equal(image.h, 256);
    const bytes = encodePng(image);
    assert.deepEqual(decodePng(bytes).rgba, image.rgba);
  }
});

test('随机加工保留边缘方向线索，亮度扰动不产生彩色噪点或大幅偏色', t => {
  const w = 128;
  const rgba = Buffer.alloc(w * w * 4);
  for (let y = 16; y < 112; y++) for (let x = 16; x < 112; x++) {
    rgba.set([128, 128, 128, 255], (y * w + x) * 4);
  }
  const cues = [[64, 26, [220, 30, 30]], [101, 64, [30, 220, 30]], [64, 101, [30, 30, 220]], [26, 64, [220, 30, 220]]];
  for (const [cx, cy, color] of cues) for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) {
    rgba.set([...color, 255], (y * w + x) * 4);
  }
  const source = Buffer.from(rgba);
  let seed = 20261031;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (const draw of [() => 0, () => 0.5, () => 1 - Number.EPSILON, random]) {
    t.mock.method(Math, 'random', draw);
    const image = obscurePuzzle({ w, h: w, rgba, bounds: { x: 16, y: 16, w: 96, h: 96 } });
    const found = new Set();
    for (let i = 0; i < image.rgba.length; i += 4) {
      const [r, g, b, a] = image.rgba.subarray(i, i + 4);
      assert.equal(a, 255);
      if (r > 180 && g < 70 && b < 70) found.add('top');
      if (g > 180 && r < 70 && b < 70) found.add('right');
      if (b > 180 && r < 70 && g < 70) found.add('bottom');
      if (r > 180 && b > 180 && g < 70) found.add('left');
      // 灰色背景约占 99%，保持亮度接近原图，且 RGB 通道同步变化。
      if (r === g && g === b) assert.ok(Math.abs(r - 128) <= 20);
    }
    assert.equal(found.size, 4, '四个方向的线索都应保留');
    const center = (64 * w + 64) * 4;
    assert.equal(image.rgba[center], image.rgba[center + 1]);
    assert.equal(image.rgba[center], image.rgba[center + 2]);
    t.mock.restoreAll();
  }
  assert.deepEqual(rgba, source, '加工不能改写题库原图');
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
