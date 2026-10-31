import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';

/* ================================================================
   真实图片回正验证的支撑模块：纯 Node 实现（零外部依赖）——
   解码 PNG → 双线性旋转像素 → 重新编码 PNG。
   旋转在服务端像素层完成，角度不出现在任何标记里，只能真的去看图。

   支持的输入：8-bit、非隔行，颜色类型 0（灰度）/ 2（RGB）/
   4（灰+透明）/ 6（RGBA）。其它格式直接抛错，由调用方跳过该文件。
   ================================================================ */

const BPP = { 0: 1, 2: 3, 4: 2, 6: 4 };

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function decodePng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('不是 PNG 文件');
  let off = 8;
  let w = 0, h = 0, depth = 0, colorType = 0;
  const idat = [];
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    if (len > buf.length - off - 12) throw new Error('PNG 数据块被截断');
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      if (len !== 13) throw new Error('PNG IHDR 长度不正确');
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      if (data[10] !== 0 || data[11] !== 0) throw new Error('不支持的压缩/滤波方式');
      if (data[12] !== 0) throw new Error('不支持隔行扫描 PNG');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  const bpp = BPP[colorType];
  if (!w || !h || w > 4096 || h > 4096) throw new Error('PNG 尺寸不正确或超过 4096px');
  if (!bpp || depth !== 8) throw new Error(`不支持的 PNG 格式（类型 ${colorType}，位深 ${depth}）`);

  const stride = w * bpp;
  const expected = (stride + 1) * h;
  const raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: expected });
  if (raw.length !== expected) throw new Error('PNG 像素数据长度不正确');
  const rgba = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    const row = raw.subarray(rowStart + 1, rowStart + 1 + stride);
    const unf = Buffer.from(row);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? unf[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      switch (filter) {
        case 0:
          break;
        case 1:
          unf[x] = (unf[x] + a) & 0xff;
          break;
        case 2:
          unf[x] = (unf[x] + b) & 0xff;
          break;
        case 3:
          unf[x] = (unf[x] + ((a + b) >> 1)) & 0xff;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          unf[x] = (unf[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
        default:
          throw new Error('未知滤波类型');
      }
    }
    for (let x = 0; x < w; x++) {
      const si = x * bpp;
      const di = (y * w + x) * 4;
      rgba[di] = unf[si];
      rgba[di + 1] = colorType === 0 || colorType === 4 ? unf[si] : unf[si + 1];
      rgba[di + 2] = colorType === 0 || colorType === 4 ? unf[si] : unf[si + 2];
      rgba[di + 3] = colorType === 4 ? unf[si + 1] : colorType === 6 ? unf[si + 3] : 255;
    }
    prev = unf;
  }
  return { w, h, rgba };
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** RGBA → PNG。逐行用 Paeth 滤波（类型 4），照片上压缩率比不滤波好不少。
    使用 level 3 无损压缩，避免逐题执行最高等级压缩占用请求时间。
    预测值一律取「原始」字节（本行 x-4 与上一行同位置），PNG 滤波定义如此。 */
export function encodePng({ w, h, rgba }) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const out = y * (stride + 1);
    raw[out] = 4;
    const row = rgba.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rgba.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? row[x - 4] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= 4 ? prev[x - 4] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      raw[out + 1 + x] = (row[x] - pr) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 3 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * 屏幕坐标中顺时针旋转 deg 度，客户端需以 -deg 回正。
 * 结果画布取 w/h 的较大者，画不下的角落留透明。
 */
export function rotatePixels(pic, deg) {
  return rotateImage(pic, deg, false);
}

function rotateImage(pic, deg, circleOnly) {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const size = Math.max(pic.w, pic.h);
  const out = Buffer.alloc(size * size * 4);
  const cx = pic.w / 2;
  const cy = pic.h / 2;
  const c2 = size / 2;
  const radiusSquared = Math.max(0, c2 - 2) ** 2;
  for (let y = 0; y < size; y++) {
    const dy = y - c2;
    const dySquared = dy * dy;
    if (circleOnly && dySquared > radiusSquared) continue;
    const halfWidth = circleOnly ? Math.sqrt(radiusSquared - dySquared) : c2;
    // 边界多取一个像素，再按平方距离精确判断，避免 sqrt 舍入裁掉圆周。
    const start = circleOnly ? Math.max(0, Math.ceil(c2 - halfWidth) - 1) : 0;
    const end = circleOnly ? Math.min(size - 1, Math.floor(c2 + halfWidth) + 1) : size - 1;
    for (let x = start; x <= end; x++) {
      const dx = x - c2;
      // 输出缓冲区初始全零：外圈不采样，也不会带出隐藏的 RGB 数据。
      if (circleOnly && dx * dx + dySquared > radiusSquared) continue;
      const sx = cx + dx * cos + dy * sin;
      const sy = cy - dx * sin + dy * cos;
      if (sx < 0 || sy < 0 || sx > pic.w - 1 || sy > pic.h - 1) continue;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const left = 1 - fx, top = 1 - fy;
      const x1 = Math.min(x0 + 1, pic.w - 1);
      const y1 = Math.min(y0 + 1, pic.h - 1);
      const o00 = (y0 * pic.w + x0) * 4;
      const o01 = (y0 * pic.w + x1) * 4;
      const o10 = (y1 * pic.w + x0) * 4;
      const o11 = (y1 * pic.w + x1) * 4;
      const di = (y * size + x) * 4;
      for (let c = 0; c < 4; c++) {
        out[di + c] = Math.round(
          pic.rgba[o00 + c] * left * top +
            pic.rgba[o01 + c] * fx * top +
            pic.rgba[o10 + c] * left * fy +
            pic.rgba[o11 + c] * fx * fy
        );
      }
    }
  }
  return { w: size, h: size, rgba: out };
}

/** 双线性缩到 maxSize 见方，缩小后减少旋转和编码的开销。 */
export function resize(pic, maxSize, enlarge = false) {
  const size = enlarge ? maxSize : Math.min(maxSize, Math.max(pic.w, pic.h));
  if (size === pic.w && size === pic.h) return pic;
  const out = Buffer.alloc(size * size * 4);
  const sx = pic.w / size;
  const sy = pic.h / size;
  const columns = Array.from({ length: size }, (_, x) => {
    const fx = x * sx, x0 = Math.min(Math.floor(fx), pic.w - 1);
    return { x0: x0 * 4, x1: Math.min(x0 + 1, pic.w - 1) * 4, tx: fx - x0 };
  });
  for (let y = 0; y < size; y++) {
    const fy = y * sy;
    const y0 = Math.min(Math.floor(fy), pic.h - 1);
    const y1 = Math.min(y0 + 1, pic.h - 1);
    const ty = fy - y0;
    const row0 = y0 * pic.w * 4, row1 = y1 * pic.w * 4;
    const top = 1 - ty;
    for (let x = 0; x < size; x++) {
      const { x0, x1, tx } = columns[x], left = 1 - tx;
      const o00 = row0 + x0;
      const o01 = row0 + x1;
      const o10 = row1 + x0;
      const o11 = row1 + x1;
      const di = (y * size + x) * 4;
      for (let c = 0; c < 4; c++) {
        out[di + c] = Math.round(
          pic.rgba[o00 + c] * left * top +
            pic.rgba[o01 + c] * tx * top +
            pic.rgba[o10 + c] * left * ty +
            pic.rgba[o11 + c] * tx * ty
        );
      }
    }
  }
  return { w: size, h: size, rgba: out };
}

export function rotateToPng(pic, deg) {
  return encodePng(rotatePixels(pic, deg));
}

// 客户端只显示圆形区域。发送前清除外圈全部 RGBA，避免方形透明边角泄露旋转角度。
export function rotatePuzzleToPng(pic, deg) {
  return encodePng(rotateImage(pic, deg, true));
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * 发题前做轻微随机加工，优先保留人眼判断朝向需要的主体、地平线和色彩。
 * 居中轻裁剪、柔和光照和少量亮度噪声让每次出题的像素有所不同。
 * 这些处理不保证抵抗原图匹配；生产部署仍应使用方向明确的私有题库。
 */
export function obscurePuzzle(pic) {
  const size = pic.w;
  const b = pic.bounds || { x: 0, y: 0, w: size, h: size };
  // 每条边保留至少约 89% 内容；仅在中心附近小幅偏移，避免裁掉方向线索。
  const zoom = 1.03 + Math.random() * 0.09;
  const cw = Math.min(b.w, Math.max(24, Math.floor(b.w / zoom)));
  const ch = Math.min(b.h, Math.max(24, Math.floor(b.h / zoom)));
  const offset = (length, crop) => Math.round((length - crop) / 2 + (Math.random() - 0.5) * Math.min(length - crop, length * 0.04));
  const ox = b.x + offset(b.w, cw);
  const oy = b.y + offset(b.h, ch);

  const cropped = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const start = ((oy + y) * size + ox) * 4;
    pic.rgba.copy(cropped, y * cw * 4, start, start + cw * 4);
  }
  const up = resize({ w: cw, h: ch, rgba: cropped }, size, true);

  // 稀疏亮度场仅作 ±6% 的柔和变化，避免明显斑块和过曝。
  const GRID = 5;
  const field = Array.from({ length: GRID * GRID }, () => 0.94 + Math.random() * 0.12);
  const columns = Array.from({ length: size }, (_, x) => {
    const gx = (x / size) * (GRID - 1);
    const x0 = Math.min(Math.floor(gx), GRID - 2);
    return { x0, fx: gx - x0 };
  });

  // 保留完整色阶；三个通道共享亮度噪声，避免彩色颗粒破坏轮廓和细节。
  const gamma = 0.96 + Math.random() * 0.08;
  const bright = Math.round((Math.random() - 0.5) * 6);
  const gammaValues = Float64Array.from({ length: 256 }, (_, value) => Math.pow(value / 255, gamma) * 255);
  for (let y = 0; y < up.h; y++) {
    const gy = (y / size) * (GRID - 1), y0 = Math.min(Math.floor(gy), GRID - 2);
    const fy = gy - y0, top = 1 - fy, row = y0 * GRID;
    for (let x = 0; x < up.w; x++) {
      const i = (y * up.w + x) * 4;
      if (up.rgba[i + 3] === 0) continue; // 透明角落不掺噪
      const { x0, fx } = columns[x], left = 1 - fx;
      const a = field[row + x0], b = field[row + x0 + 1];
      const c = field[row + GRID + x0], d = field[row + GRID + x0 + 1];
      const mul = a * left * top + b * fx * top + c * left * fy + d * fx * fy;
      const noise = bright + Math.round((Math.random() - 0.5) * 4);
      for (let c = 0; c < 3; c++) {
        up.rgba[i + c] = clamp255(Math.round(gammaValues[up.rgba[i + c]] * mul + noise));
      }
    }
  }
  return up;
}
