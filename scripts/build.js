import { build } from 'esbuild';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const common = { absWorkingDir: fileURLToPath(root), bundle: true, target: ['es2022'], minify: false, legalComments: 'none' };
await fs.mkdir(new URL('dist/', root), { recursive: true });
await build({ ...common, entryPoints: ['src/client/index.js'], format: 'esm', outfile: 'dist/captcha.esm.js' });
await build({ ...common, entryPoints: ['src/client/index.js'], format: 'iife', globalName: 'Captcha', define: { 'import.meta.url': 'document.currentScript.src' }, outfile: 'dist/captcha.js' });
await build({ ...common, entryPoints: ['src/client/pow-worker.js'], format: 'iife', outfile: 'dist/pow-worker.js' });
await fs.copyFile(new URL('src/client/captcha.css', root), new URL('dist/captcha.css', root));
await fs.mkdir(new URL('dist/landing/', root), { recursive: true });
await fs.copyFile(new URL('landing/index.html', root), new URL('dist/index.html', root));
for (const name of ['styles.css', 'app.js', 'favicon.svg']) {
  await fs.copyFile(new URL('landing/' + name, root), new URL('dist/landing/' + name, root));
}
console.log('已构建 ESM、普通脚本、Worker 和独立样式。');
