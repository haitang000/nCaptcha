import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPuzzles, validatePrivatePuzzles } from '../src/images.js';
await import('./build.js');
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
let imagesDir, privatePool = false, minimum = 32;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--images-dir' && args[i + 1]) imagesDir = path.resolve(args[++i]);
  else if (args[i] === '--private') privatePool = true;
  else if (args[i] === '--min-images' && args[i + 1]) minimum = Number(args[++i]);
  else throw new Error('用法：npm run build:workers -- [--images-dir <目录>] [--private] [--min-images <数量>]');
}
if (!Number.isInteger(minimum) || minimum < 1 || minimum > 100000) throw new Error('--min-images 必须为 1–100000 的整数');
if (privatePool && !imagesDir) throw new Error('--private 必须指定独立的 --images-dir');
const bundled = path.join(root, 'assets/puzzles');
const puzzles = loadPuzzles(imagesDir ?? bundled);
if (!puzzles.length) throw new Error('未找到可用 PNG 题图');
const uniqueCount = privatePool ? validatePrivatePuzzles(puzzles, loadPuzzles(bundled), minimum) : 0;
await fs.mkdir(path.join(root, '.workers'), { recursive: true });
await fs.writeFile(path.join(root, '.workers/puzzles.js'), '// 服务端题库；不能放入公开 assets 目录或分发私有部署包。\nexport const puzzleSource = ' + JSON.stringify({ privatePool, uniqueCount }) + ';\nexport default ' + JSON.stringify(puzzles.map(({ rgba, ...image }) => ({ ...image, rgba: rgba.toString('base64') }))) + ';\n');
console.log(`Workers 题库已打包：${puzzles.length} 张，无运行时文件读取。`);
