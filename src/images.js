// Node.js 题图库加载器；像素算法由无文件系统依赖的 image-codec.js 共享。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, resize } from './image-codec.js';
export { decodePng, encodePng, rotatePixels, rotateToPng, obscurePuzzle } from './image-codec.js';

/** 读目录里所有 PNG 题图，解码 + 缩到 maxSize。哪张坏了跳过哪张，不拖垮启动。
 *  顺便记下内容区（非透明像素的包围盒）：发题时的随机裁剪只在内容里进行，
 *  别把照片里指向「上」的方位线索切出画面。 */
export function loadPuzzles(dir, maxSize = 256) {
  if (dir instanceof URL) dir = fileURLToPath(dir);
  const out = [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((n) => /\.png$/i.test(n)).sort();
  } catch {
    return out;
  }
  for (const name of files) {
    try {
      const pic = resize(decodePng(fs.readFileSync(path.join(dir, name))), maxSize);
      let minX = pic.w, minY = pic.h, maxX = -1, maxY = -1;
      for (let y = 0; y < pic.h; y++) {
        for (let x = 0; x < pic.w; x++) {
          if (pic.rgba[(y * pic.w + x) * 4 + 3] === 0) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      if (maxX >= minX && maxY >= minY) {
        pic.bounds = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
      } else continue;
      out.push(pic);
    } catch (err) {
      console.error(`[captcha] 跳过无法解码的题图 ${name}: ${err.message}`);
    }
  }
  return out;
}
