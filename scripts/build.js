import { build } from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const obfuscatedModules = new Map();
const obfuscateClient = {
  name: 'obfuscate-client',
  setup(build) {
    // 只混淆明确列出的验证模块；UI 入口、键盘交互及 SHA-256 热循环只做常规压缩。
    build.onLoad({ filter: /[\\/]src[\\/]client[\\/](tracking|agent-trap|pow|pow-worker)\.js$/ }, async ({ path: filename }) => {
      if (!obfuscatedModules.has(filename)) {
        const source = await fs.readFile(filename, 'utf8');
        const result = JavaScriptObfuscator.obfuscate(source, {
          compact: true,
          target: 'browser-no-eval',
          seed: 0x4e436170,
          identifiersPrefix: `nc_${path.basename(filename, '.js').replaceAll('-', '_')}_`,
          renameGlobals: false,
          renameProperties: false,
          stringArray: true,
          stringArrayEncoding: ['base64'],
          stringArrayThreshold: 1,
          stringArrayCallsTransform: false,
          controlFlowFlattening: false,
          deadCodeInjection: false,
          debugProtection: false,
          disableConsoleOutput: false,
          selfDefending: false,
          sourceMap: false,
        });
        obfuscatedModules.set(filename, result.getObfuscatedCode());
      }
      return { contents: obfuscatedModules.get(filename), loader: 'js' };
    });
  },
};
// 混淆先于打包，保留 ESM 导出、普通脚本全局入口及 import.meta.url 的构建替换。
const common = { absWorkingDir: fileURLToPath(root), bundle: true, target: ['es2022'], minify: true, legalComments: 'none', loader: { '.svg': 'dataurl' }, plugins: [obfuscateClient] };
await fs.mkdir(new URL('dist/', root), { recursive: true });
await build({ ...common, entryPoints: ['src/client/index.js'], format: 'esm', outfile: 'dist/captcha.esm.js' });
await build({ ...common, entryPoints: ['src/client/index.js'], format: 'iife', globalName: 'Captcha', define: { 'import.meta.url': 'document.currentScript.src' }, outfile: 'dist/captcha.js' });
await build({ ...common, entryPoints: ['src/client/pow-worker.js'], format: 'iife', outfile: 'dist/pow-worker.js' });
await build({ ...common, entryPoints: ['src/client/captcha.css'], outfile: 'dist/captcha.css' });
console.log('已构建 ESM、普通脚本、Worker 和独立样式；仅验证相关模块已混淆。');
