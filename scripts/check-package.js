import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
await import('./build-workers.js');
const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('请通过 npm run test:package 运行');
function run(cmd, args, cwd = root) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.error?.message ?? result.stderr + result.stdout);
  return result.stdout;
}
const packed = JSON.parse(run(process.execPath, [npm, 'pack', '--json', '--ignore-scripts']));
const info = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
assert.ok(!info.files.some(file => file.path.startsWith('test/')));
for (const name of ['src/index.js', 'src/index.d.ts', 'src/http.js', 'src/client/index.d.ts', 'dist/captcha.js', 'dist/captcha.esm.js', 'dist/captcha.css', 'dist/pow-worker.js', 'assets/puzzles/puzzle-1.png', 'examples/page.html', 'workers/index.js', '.workers/puzzles.js', 'wrangler.jsonc', 'docs/WORKERS.md']) assert.ok(info.files.some(file => file.path === name), name);
assert.ok(!info.files.some(file => file.path === '.dev.vars' || file.path === '.env' || file.path.startsWith('.wrangler/') || file.path.startsWith('.workers/bundle/')));
await fs.mkdir(path.join(root, '.package-check'), { recursive: true });
const directory = await fs.mkdtemp(path.join(root, '.package-check/run-'));
await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'captcha-integration-check', private: true, type: 'module' }));
run(process.execPath, [npm, 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', path.join(root, info.filename)], directory);
await fs.writeFile(path.join(directory, 'verify.mjs'), `
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createCaptcha } from 'portable-captcha';
import { createHttpHandler } from 'portable-captcha/http';
const c = createCaptcha({ powBits:0, minSolveMs:0, minTokenAgeMs:0 });
const handler = createHttpHandler(c);
const server = http.createServer(async (req,res)=>{ if (!await handler(req,res)) { res.writeHead(404);res.end(); } });
server.listen(0,'127.0.0.1'); await once(server,'listening');
try {
  const base = 'http://127.0.0.1:' + server.address().port;
  for (const name of ['captcha.js','captcha.esm.js','captcha.css','pow-worker.js']) assert.equal((await fetch(base+'/captcha/assets/'+name)).status,200);
  const ctx = {ip:'127.0.0.1',action:'integration'};
  const p = await c.createPow(ctx);
  const {challenge} = await c.verifyBehavior({...ctx,pow:{prefix:p.prefix,nonce:'0'}});
  assert.ok(challenge.image.startsWith('data:image/png;base64,'));
  await c.cancelChallenge({...ctx,id:challenge.id});
  c.setMode('normal');
  const next = await c.createPow(ctx);
  const result = await c.verifyBehavior({...ctx,pow:{prefix:next.prefix,nonce:'0'},formBehavior:{totalMs:5000,focusOrder:['a','b'],fields:{a:{n:6,meanGap:100,varGap:300},b:{n:6,meanGap:100,varGap:300}}}});
  assert.equal(await c.consumeToken({...ctx,token:result.token}),true);
  assert.equal(await c.consumeToken({...ctx,token:result.token}),false);
  console.log('安装后的包：库、题图、HTTP 静态资源及一次性业务消费均通过。');
} finally { server.closeAllConnections(); await new Promise(r=>server.close(r)); await c.close(); }
`);
console.log(run(process.execPath, ['verify.mjs'], directory).trim());
console.log(`分发包：${path.join(root, info.filename)}（${info.files.length} 个文件）`);
