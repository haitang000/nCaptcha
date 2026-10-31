# CAPTCHA

现已支持 **Cloudflare Workers**：使用 SQLite Durable Objects 保存验证状态，浏览器接入协议保持一致。见 [Workers 本地运行与部署说明](docs/WORKERS.md)。

已发布的服务地址与接入配置见 [当前部署](docs/DEPLOYED.md)。

从 localhosting 提取的可嵌入验证码：行为评分、SHA-256 工作量证明（PoW）、图片回正和一次性令牌。提供后端库、原生浏览器组件以及独立 HTTP 服务；无需数据库、外部验证码服务或运行时第三方依赖。

需要 **Node.js ≥22.5**。浏览器支持现代 Chrome、Edge、Firefox、Safari（需要 Shadow DOM、`dialog` 和 Pointer Events）。已自动验证 Chromium 桌面和移动触屏模式。包为 JavaScript ESM，并附带 TypeScript 声明。

## 先运行示例

在 PowerShell 中：

```powershell
cd F:\code\CAPTCHA
npm ci
npm run build
npm run demo
```

打开 [Landing page 与在线体验](http://127.0.0.1:8787/)。首页可体验真实的 PoW 和图片回正验证，切换组件深浅主题，并将令牌提交到服务端核验；还提供验证机制介绍、可复制的接入代码和常见问题。

原有 [普通 script 示例](http://127.0.0.1:8787/examples) 与 [ES module 示例](http://127.0.0.1:8787/module) 仍可运行；示例展示两个独立组件。点击“验证并提交”会先验证，再由业务后端消费令牌。

Landing page 源码位于 `landing/`，随 `npm run build` 复制到 `dist/`。Workers 部署也会在根路径提供同一页面。公开的 `POST /demo/verify` 仅接受同源请求，只核验绑定当前 IP、用途为 `landing-demo` 的令牌；业务令牌仍由业务后端通过受密钥保护的 `/siteverify` 核验。

## 在 Node.js 服务内嵌入

开发时可从其他项目安装本目录，或安装打包文件：

```powershell
npm install F:\code\CAPTCHA
# 可选：在本项目运行 npm pack，再安装生成的 portable-captcha-0.2.0.tgz
```

以下是一个最小原生 HTTP 接入示例。业务接口需要核验令牌，不能只依赖浏览器成功回调。

```js
import http from 'node:http';
import { createCaptcha } from 'portable-captcha';
import { createHttpHandler, getClientIp, readJson, sendJson } from 'portable-captcha/http';

const captcha = createCaptcha({ mode: 'strict' });
const handleCaptcha = createHttpHandler(captcha, {
  allowedOrigins: ['https://your-service.example'],
});

const server = http.createServer(async (req, res) => {
  try {
    if (await handleCaptcha(req, res)) return;
    if (req.url === '/submit' && req.method === 'POST') {
      const body = await readJson(req);
      const success = await captcha.consumeToken({
        token: body.captcha_token, ip: getClientIp(req), action: 'register',
      });
      if (!success) return sendJson(res, 400, { error: '请重新验证' });
      // 执行实际业务；令牌从这里开始已经被消费。
      return sendJson(res, 200, { success: true });
    }
    sendJson(res, 404, { error: '未找到' });
  } catch (error) {
    sendJson(res, error.status ?? 500, { error: error.message });
  }
});
server.on('close', () => { void captcha.close(); });
server.listen(8080);
```

业务表单的来源校验、会话和业务限流仍由宿主管理。若存在反向代理，签发和核验令牌应使用**同一套真实 IP 提取规则**。IPv6 的等价压缩/展开写法、大小写及 IPv4 映射地址会统一规范化，共享限流、失败声誉和令牌绑定。全局地址中无意义的作用域后缀会移除，链路本地地址的有效接口作用域仍保留，以免扩大可信代理范围。

Express 无需额外安装适配器包：

```js
import { createExpressMiddleware } from 'portable-captcha/http';
app.use(express.json({ limit: '64kb' }));
app.use(createExpressMiddleware(captcha, {
  allowedOrigins: ['https://your-service.example'],
}));
```

推荐将中间件挂到应用根路径。也可 `app.use('/security', middleware)`，此时 `basePath`、`assetPath` 按 Express 剥离挂载前缀后的路径配置，例如保留 `/captcha/v1`；浏览器使用 `/security/captcha/v1` 与 `/security/captcha/assets/`。

## 在浏览器中嵌入

由 HTTP 处理器提供四个静态文件，默认位于 `/captcha/assets/`。亦可复制 `dist` 的全部四个文件到自己的静态目录。

普通 script：

```html
<form id="signup">
  <input name="username" autocomplete="username">
  <div id="captcha"></div>
  <button type="submit">注册</button>
</form>
<script src="/captcha/assets/captcha.js"></script>
<script>
  const form = document.querySelector('#signup');
  const captcha = Captcha.render('#captcha', {
    apiUrl: '/captcha/v1',
    action: 'register',
    form,
    onExpire() { console.log('需要重新验证'); },
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const token = await captcha.verify();
      if (!token) return; // 用户取消
      const data = Object.fromEntries(new FormData(form));
      data.captcha_token = token;
      const response = await fetch('/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error('提交失败，请重试');
    } catch (error) {
      if (error.name !== 'AbortError') console.error(error.message);
    } finally {
      captcha.reset(); // 后端消费后必须重新验证，下次业务请求不能复用令牌
    }
  });
</script>
```

ES module 与打包器接入：

```js
import { render } from 'portable-captcha/client';
// 或浏览器中 import { render } from '/captcha/assets/captcha.esm.js';
const widget = render(element, {
  apiUrl: '/captcha/v1',
  assetBaseUrl: '/captcha/assets/',
  action: 'login',
});
// 页面卸载、路由切换或框架组件 unmount 时：
widget.destroy();
```

方法：`verify(): Promise<string | null>`、`getToken(): string | null`、`reset(): void`、`destroy(): void`。同一实例的并发 `verify()` 合并为同一任务；`reset/destroy` 使进行中的任务以 `AbortError` 拒绝。销毁可重复调用，销毁后 `verify()` 返回 `DESTROYED` 错误。

选项：`apiUrl`、`action`（默认 `default`）、`form`（表单元素或选择器）、`assetBaseUrl`、`workerUrl`、`prewarm`（默认 `true`）、自定义 `fetch`。回调为 `onSuccess(token)`、`onError(error)`、`onExpire()`、`onStateChange(state)`。状态为 `idle/loading/verified/error/destroyed`。组件等待服务端规定的最短令牌使用时间后才触发成功。

图片方向验证失败时，组件会保留当前弹窗，释放旧挑战并自动获取新题；旧图片向左移出，新图片从右侧向左进入，滑块归零后开始下一轮。整个过程沿用同一次 `verify()` 调用，直到通过、取消或出现无法继续的错误。通过或取消时，弹窗与遮罩完成退出动画后再关闭；系统开启“减少动态效果”时跳过位移动画。

PoW 默认在挂载时预热；Worker 和主线程回退都复用 SHA-256 单块缓冲区，避免每次尝试重复编码、分配和转换十六进制字符串。题图生成复用每题的 gamma 查表，并采用 PNG level 3 无损压缩。优化不降低 PoW 难度、不缩短安全等待或动效时间；验证耗时仍取决于设备算力、网络和配置。

组件的 CSS、Worker 与弹窗分别归实例管理。默认从组件脚本所在目录加载 CSS 和 Worker；打包器项目应明确设置 `assetBaseUrl`，并将四个构建文件复制到该目录。跨域加载 Worker 可能受浏览器策略限制，组件会回退到分块计算；将 Worker 放在业务页面同源目录可启用后台计算。严格 CSP 需要允许相应脚本、样式、图片 `data:`、API 连接与 Worker 来源；Worker 加载失败仍可回退。

通过容器的 CSS 变量定制外观，例如：

```css
#captcha {
  --captcha-accent: #7c3aed;
  --captcha-button-radius: 8px; /* 验证按钮圆角 */
  --captcha-dialog-radius: 20px; /* 图片验证弹窗圆角 */
}
```

`--captcha-button-radius` 与 `--captcha-dialog-radius` 可独立设置，默认分别为 `14px` 和 `16px`。仍兼容原有的 `--captcha-radius`：未单独指定按钮或弹窗圆角时，按钮使用该值，弹窗使用该值加 `2px`。

其他变量有 `--captcha-bg`、`--captcha-fg`、`--captcha-muted`、`--captcha-border`、`--captcha-success`、`--captcha-danger`。默认跟随深浅主题与减少动态效果偏好；样式限定在 Shadow DOM 内。

图片回正弹窗采用圆形预览与胶囊滑块，松开滑块自动验证。鼠标和触屏均可拖动；键盘可用方向键微调后按 Enter 确认，Escape 或点击弹窗外可取消。图片拖动操作仍保留。`--captcha-track` 可自定义滑轨背景色。

图片验证期间会独立采集本轮弹窗内的鼠标、触屏或笔轨迹，提交答案时由服务端同时检查轨迹与角度。缺失轨迹、静止点、过短操作和机械匀速等间隔轨迹会被拒绝；支持正常的直线滑动及短距离微调。轨迹最多提交 100 个点，换题时清空，取消、重置或销毁时移除监听。键盘操作提交 `pointer: 'keyboard'` 与按键记录，服务端重放按键后核对最终角度；仅改变输入方式字段不能跳过行为校验。指针与键盘混合操作会保留并检查已有指针轨迹。

启用验证码时始终要求完成 PoW 与图片挑战。原 `normal` 模式作为兼容名称保留，已取消根据客户端填写统计或轨迹评分直接签发令牌的路径。题图下发前会清除圆形显示区域外的全部 RGBA 数据，避免原始方形画布的透明边角泄露旋转信息。行为记录仍可由客户端伪造，不能代替图片答案、服务端等待时间与一次性令牌校验。

## 独立服务：其他语言也能接入

```powershell
Copy-Item .env.example .env
# 在 .env 填写 CAPTCHA_SECRET，例如用下面命令生成后复制进去：
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npm start
```

另开一个终端，在相同目录运行 `npm run demo:standalone`，打开 [跨域接入示例](http://127.0.0.1:8788/)。示例从独立服务加载组件和挑战，业务后端通过 `/siteverify` 核验。密钥只出现在两个后端的 `.env` 中。

一个服务实例对应一个业务。默认绑定 `127.0.0.1:8787`，健康检查为 `GET /health`。`.env` 仅在入口执行时读取；导入核心库或服务模块不会读环境、启动服务或定时任务。退出服务会释放其内存存储。

浏览器完成验证后，把 token 提交给自己的业务后端。业务后端发送：

```http
POST /captcha/v1/siteverify
Authorization: Bearer <CAPTCHA_SECRET>
Content-Type: application/json

{"token":"<浏览器提交的令牌>","ip":"<真实客户端IP>","action":"register"}
```

合法核验请求返回 `200 {"success":true|false}`。核验成功即消费令牌；网络超时后不能假定令牌仍有效，业务端应让用户重新验证。密钥错误返回 401。带 Origin 的请求及该端点的 CORS 预检会被拒绝，浏览器不应直接调用此接口。

默认接口如下。所有 JSON 请求体上限为 64KiB；错误统一返回 `{ error, code, ...details }`。

| 方法与路径 | 请求 | 成功返回 |
| --- | --- | --- |
| GET `/pow?action=register` | 用途查询参数 | `{ prefix, bits, expiresInMs }` |
| POST `/verify` | `{ action, pow:{prefix,nonce}, trajectory?, formBehavior?, hints? }` | 令牌结果或 `{ challenge:{id,image,expiresInMs} }` |
| POST `/challenge` | `{ action, id, angle, pointer?, trajectory?, keyboard?, hints? }` | `{ token, expiresInMs, usableAfterMs }` |
| POST `/cancel` | `{ action, id }` | `{ cancelled:boolean }` |
| POST `/siteverify` | 服务端密钥和 `{ token, ip, action }` | `{ success:boolean }` |

浏览器接口的 IP 只由连接地址/可信代理解析，忽略请求体中的 `ip`。角度为客户端 CSS 顺时针旋转量，整数或有限小数均可；图片已顺时针旋转，所以正确提交值对应服务端角度的负值。失败后 `ANGLE_INCORRECT` 可继续微调；`CHALLENGE_EXHAUSTED/CHALLENGE_EXPIRED` 必须重新验证。

`/challenge` 的 `trajectory` 为本轮图片验证的 `{x,y,t}[]`，`t` 从 0 开始且严格递增，至少需要 3 个点并覆盖 80ms，不能超过服务端记录的挑战已用时间（允许 250ms 时钟误差）。鼠标、触屏、笔使用相同的轨迹规则和服务端配置的角度容差。缺失或低质量轨迹同样消耗本题尝试次数并计入失败声誉；浏览器组件收到 `BEHAVIOR_REJECTED` 会在当前弹窗中自动换题。

键盘客户端须提交 `keyboard: { startAngle, events: [{ key, control, t }] }`。`startAngle` 为开始键盘操作时的整数角度，纯键盘从 0 开始；非零起点还需提供通过检查的指针轨迹。`control` 为 `range` 或 `stage`；方向键分别调整 1° 或 15°，PageUp/Down 为对应步长的 10 倍，Home/End 为 0°/359°。滑块在边界处截断，图片区域循环旋转。最多 512 条记录，`t` 为本轮交互开始后的毫秒数，严格递增，末条必须是 Enter，至少经过 80ms，并与服务端时间和提交角度相符。自定义客户端需同步更新；仅提交 `pointer: 'keyboard'` 会返回 `BEHAVIOR_REJECTED`。

`CAPTCHA_ALLOWED_ORIGINS` 配置精确来源白名单（含协议和非默认端口，无末尾斜杠），多个来源用逗号分隔。浏览器同源 POST 也可能带 Origin，需将业务自身 origin 列入。未携带 Origin 的服务端请求仍可访问公开挑战接口；来源白名单不是身份认证。

`CAPTCHA_TRUSTED_PROXIES` 为紧邻服务的可信代理 IP 列表，默认空且忽略 `X-Forwarded-For`。第一版支持单层代理，采用该代理追加的最右侧 IP；多层代理请在网关先规范化为一个真实客户端地址。业务核验侧应使用一致规则。宿主路由原有 CSRF、账号限流与会话管理应自行保留。

## 核心配置与存储扩展

`createCaptcha(options)` 返回 `createPow`、`verifyBehavior`、`solveChallenge`、`cancelChallenge`、`consumeToken` 五个异步方法及 `setMode('normal'|'strict')`、`close()`。各验证方法接收包含 `{ip,action?}` 的对象，额外字段见类型声明。库核验直接调用 `consumeToken()`，不需要 HTTP 密钥。

| 配置 | 默认值 | 含义 |
| --- | --- | --- |
| `enabled` / `mode` | `true` / `strict` | 启用时始终要求图片挑战；`normal` 为已弃用的兼容别名，行为评分不能直接放行；显式关闭后直接签发令牌 |
| `powBits` | 20 | 基础难度，允许 0–28；最近失败多时最多增加 4 位，总计不超过 28 |
| `tolerance` | 10 | 所有输入方式共用的回正容差，不根据客户端自报设备类型放宽 |
| `minSolveMs` / `minTokenAgeMs` | 1000 / 300 | 最低求解和令牌使用间隔 |
| `powTtlMs` | 120000 | PoW 有效期 |
| `tokenTtlMs` / `challengeTtlMs` | 300000 / 300000 | 令牌/图片挑战有效期 |
| `maxChallengesPerIp` / `challengeTries` | 3 / 3 | 并发未解题目上限及每题尝试次数 |
| `rateLimit` / `rateWindowMs` | 60 / 600000 | 所有公开验证码操作共用每 IP 滑动窗口 |
| `imagesDir` | 内置 10 张题图 | 自备 PNG 目录；无可用题图时启动报错 |
| `store` / `namespace` | 自有内存 / 随机实例命名空间 | 外部状态接口与键前缀 |
| `now` | `Date.now` | 可注入时钟，便于模拟过期 |

内存存储默认最多 10000 个键，满时返回 503，过期项定期清理。每个自有存储的清理定时器均调用 `unref()`，`close()` 会释放。重启后未解挑战和令牌失效。注入的外部存储由调用方负责关闭。

扩展存储需实现异步 `get/set/delete/update`。**`update(key, updater)` 必须原子执行同一键的读取、同步回调和状态写回**，过期记录视为不存在，参数和返回值需与内部状态隔离。回调返回 `{ value, ttlMs, result }`；省略 `value` 表示删除，`result` 作为方法结果。不要用非原子的远程 `get` 再 `set` 实现它。Node 默认提供单进程内存实现，Workers 另提供 SQLite Durable Objects 实现，未提供 Redis 适配器。未来使用共享存储时，各副本需显式使用相同 `namespace`。

行为信号可由客户端伪造，评分只是启发式判断。图片扰动也不保证无法识别；内置题图主要用于示例，部署时可换成方向明确的私有题库。目前保留 2 张方向明确的原图，新增 8 张生成题图，移除了云海和大面积天空的麦田小路图；题图筛选标准、来源与生成提示词见 [题图库说明](assets/puzzles/README.md)。轨迹只保留有限点数，表单仅采集时间统计和字段顺序，不采集输入内容或画布指纹；所有状态按有效期清理。

## 验证与打包

```powershell
npm test
npm run test:types
npx playwright install chromium
npm run test:browser
npm run test:package
npm pack
```

后端测试覆盖 PoW、伪造行为/设备标记、键盘重放、图片透明边界侧信道、统一容差、IPv6 等价地址、TTL、并发消费、限流、跨域和适配器。浏览器测试覆盖两个组件、取消/重试、销毁、过期、Worker 回退、键盘与移动操作，以及两种示例的真实业务提交。浏览器测试使用单独的测试服务和低难度参数，测试服务不进入分发包。

`test:package` 构建并打包后，在 `.package-check` 中安装生成的 tgz，以安装后的路径验证库导出、图片、静态资源及业务令牌消费。发布包不需要运行时依赖。尚未发布到 npm，`private: true` 防止意外发布；没有擅自为提取代码或题图指定新的开源许可。
