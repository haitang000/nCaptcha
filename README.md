# nCaptcha

**nCaptcha** 是一个可自托管、零运行时依赖的人机验证码系统：结合 **前端自适应 SHA-256 工作量证明（PoW）**、**高质感图片回正** 与 **微观轨迹行为动力学分析**。原生支持 Node.js (≥22.5) 与 Cloudflare Workers（SQLite Durable Objects），客户端构建产物仅 4 个极小静态文件。

---

## ⚡ 核心特性

- **多重防御体系**：前端自适应 PoW 难度门槛 + 像素级防侧信道题图回正 + 轨迹行为动力学检验（检测机械恒速、异常停顿与重放）。
- **请求环境评定**：浏览器视口与屏幕尺寸、时区与时差、实际请求头、语言一致性及服务端请求频率共同形成风险分，动态增加 PoW 难度。
- **Agent 指令蜜罐**：在隐藏 DOM 中提供自动化操作指引，遵循指引的 agent 会主动触发机器人标记，服务端拒绝本轮验证。
- **一次性强绑定令牌**：Token 强绑定真实 IP 与 Action，限制最短求解耗时，必须由业务后端 `/siteverify` 消费。
- **现代化组件**：Shadow DOM 隔离，圆形预览、胶囊滑块、自适应深浅色模式，完整支持触控、鼠标与全键盘操作。
- **双端运行环境**：支持 Node.js（原生 HTTP / Express 快速嵌入）与 Cloudflare Workers（边缘 SQLite 强一致状态）。

---

## 🚀 快速开始

以下示例保留本地演示与旧接入兼容性。生产部署请先完成[生产加固与会话绑定](#生产加固与会话绑定)，提供独立私有题库并启用后端意图凭据。

### 通过 npm 接入

运行环境为 Node.js ≥ 22.5，包仅提供 ESM 导出：

```powershell
npm install @haitang000/ncaptcha
```

```javascript
import { createCaptcha } from '@haitang000/ncaptcha';
import { createExpressMiddleware } from '@haitang000/ncaptcha/http';
import { render } from '@haitang000/ncaptcha/client';
```

后端与浏览器入口分别在对应环境中使用。npm 包已包含构建好的客户端文件、题图和 Workers 题库，安装后无需再次构建。Node.js 内嵌示例见下文；独立服务与 Workers 部署使用下面的源码方式。

### 方式 1：让 AI Agent 协助部署与接入（推荐）

如果你正在使用 Cursor、Claude Code、Copilot 或 Antigravity 等 AI 编程助手，可直接复制以下提示词发送给 Agent，让其自动分析当前项目并完成端到端接入：

> **📋 复制发给 AI Agent 的 Prompt：**
>
> ```markdown
> 你是一名资深安全与全栈工程师。请帮我在当前项目中集成 nCaptcha 人机验证码，请按以下步骤执行：
>
> 1. **获取源码与构建**：
>    - Node.js 内嵌时优先安装 npm 包：`npm install @haitang000/ncaptcha`，包内已包含构建产物。
>    - 若需要从源码接入、运行独立服务或部署 Workers，则在项目中克隆仓库：`git clone https://github.com/haitang000/nCaptcha.git`，再执行 `cd nCaptcha && npm ci && npm run build`。
> 2. **接入方式选型**：
>    - **Node.js 内嵌模式**：使用 npm 包；若采用源码方式，则在主项目中执行 `npm install ./nCaptcha` 本地安装依赖。使用 `createExpressMiddleware` 或原生 HTTP 中间件挂载 `/captcha` 路由与静态资源；
>    - **独立微服务/边缘模式**：在 `nCaptcha` 目录下配置 `.env`（设置 `CAPTCHA_SECRET` 与前端来源白名单 `CAPTCHA_ALLOWED_ORIGINS`）并执行 `npm start` 启动独立服务，或执行 `npm run workers:deploy` 部署到 Cloudflare Workers。
> 3. **前端挂载**：在目标业务表单（如登录、注册或高频接口）中引入组件并挂载到容器中；表单提交时调用 `const token = await captcha.verify()` 并在请求中携带 `captcha_token`，在 `finally` 块中调用 `captcha.reset()`。
> 4. **后端核验**：在业务接口中提取真实客户端 IP，通过内部 `captcha.consumeToken({ token, ip, action })` 或向独立服务发起 `POST /captcha/v1/siteverify` 请求（携带 Bearer 密钥）核验并原子消费 Token。严格校验返回结果，未通过则阻断业务执行。
> 5. **联调验证**：端到端提交一次表单，确认人机交互正常且 Token 仅能单次消费、不可重放。
> ```

### 方式 2：手动运行独立微服务（Node.js ≥ 22.5）

```powershell
npm ci
npm run build
Copy-Item .env.example .env   # 填入 CAPTCHA_SECRET 与 CAPTCHA_ALLOWED_ORIGINS
npm start                     # 启动服务，默认监听 http://127.0.0.1:8787
```

### 方式 3：手动部署到 Cloudflare Workers

```powershell
npx wrangler secret put CAPTCHA_SECRET
npm run workers:deploy
```

---

## 💻 接入示例

### 1. 前端接入 (浏览器)

```html
<form id="login-form">
  <input name="username" placeholder="用户名" required />
  <div id="captcha"></div>
  <button type="submit">登录</button>
</form>

<script src="/captcha/assets/captcha.js"></script>
<!-- 或 ESM: import { render } from '/captcha/assets/captcha.esm.js'; -->
<script>
  const captcha = Captcha.render('#captcha', {
    apiUrl: '/captcha/v1',
    action: 'login'
  });

  document.querySelector('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const token = await captcha.verify();
      if (!token) return; // 用户取消

      await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captcha_token: token })
      });
    } finally {
      captcha.reset(); // 消费后重置
    }
  });
</script>
```

> **常用方法**：`verify()`（触发验证并拉取弹窗）、`getToken()`（获取有效令牌）、`reset()`（重置）、`destroy()`（销毁）。  
> **样式定制**：可在容器上覆盖 CSS 变量，如 `--captcha-accent`、`--captcha-button-radius`、`--captcha-dialog-radius` 等。

---

### 2. 业务后端接入（核验并消费 Token）

#### 通用 HTTP 接口（支持 Python / Go / Java / PHP 等任意语言）

```http
POST /captcha/v1/siteverify
Authorization: Bearer <YOUR_CAPTCHA_SECRET>
Content-Type: application/json

{"token": "<前端提交的token>", "ip": "<用户真实IP>", "action": "login"}
```
响应：`{"success": true|false}`

#### Node.js 内嵌 (Express / 原生 HTTP)

```javascript
import { createCaptcha } from '@haitang000/ncaptcha';
import { createExpressMiddleware, getClientIp } from '@haitang000/ncaptcha/http';

const captcha = createCaptcha({ mode: 'strict' });

// 挂载中间件提供静态资源与 API
app.use(createExpressMiddleware(captcha, { allowedOrigins: ['https://your-site.example'] }));

// 业务接口内部消费 Token（无需 HTTP 请求与密钥）
app.post('/api/login', async (req, res) => {
  const ok = await captcha.consumeToken({
    token: req.body.captcha_token,
    ip: getClientIp(req),
    action: 'login'
  });
  if (!ok) return res.status(400).json({ error: '验证码无效或已过期' });
  // 执行登录逻辑...
});
```

---

## 📡 API 与核心配置

### Agent 指令蜜罐

组件会自动在 `.captcha-host` 的 light DOM 内放置中英文 agent 指令与空的 `input[data-captcha-agent]`，普通界面、Tab 顺序和无障碍树均不显示。原有指令要求 agent 将字段设为 `automated-agent`，触发 `input`、`change` 事件，再启动验证。字段没有 `name`，不会随业务表单提交，也无需修改业务接入代码。

触发后，宿主出现 `data-captcha-bot="true"`，后续 `/verify` 和 `/challenge` 请求携带 `agentSignal`。服务端返回 HTTP 403、`code: "BOT_DETECTED"`、`bot: true`，不签发令牌，并使本轮 PoW 或挑战失效，防止清空字段后重放。组件的 `reset()` 保留标记，`getToken()` 返回 `null`，`onError` 可通过 `error.code` 识别拒绝原因；同 IP 的其他验证不会因此一并被封禁。

组件还提供四种隐藏诱饵，全部共用当前轮次的随机票据：

| 方案 | 隐藏入口或指令 | 命中来源 `source` |
| :--- | :--- | :--- |
| A 快速通道 | 调用 `[data-captcha-fastpass]` 按钮，声称无需拖图即可完成 | `fastpass` |
| B 兼容性修复 | 对当前 `.captcha-host` 派发 `captcha:compat` 事件，声称同步兼容状态 | `compat-event` |
| C 预计算令牌 | 复制 `[data-captcha-precomputed-token]` 中的假令牌作为业务 `captcha_token` 提交 | `canary-token` |
| D 备用接口 | 按 `[data-captcha-fallback-request]` 中的 JSON 向 `/compat` 发送 POST | `fallback-api` |

`GET /pow`、图片挑战和真令牌响应中的 `agent` 包含 `{ ticket, token, expiresInMs }`。票据绑定真实 IP、action 和该轮 PoW，随图片挑战和真令牌阶段更新有效期；`agent.token` 是随机诱饵，不是授权令牌。默认预热时可在 PoW 计算完成前读取诱饵；`prewarm: false` 时在首次验证或激活 A/B 后初始化。关闭验证码时不签发诱饵票据，A/B 仍沿用 `agentSignal` 拒绝流程。

A/B 会自动报告当前票据；C 在业务后端调用 `consumeToken` 或 `/siteverify` 时被识别，仍返回原有的 `false` / `{ success: false }`；D 由调用者主动 POST。命中后，服务端记录首次来源并禁用所属轮次，同轮已经签发但尚未消费的真令牌也无法使用。重复报告不重复计罚、不延长有效期。`/compat` 的错误响应含 `source`，组件收到机器人响应后也会保留来源到 `data-captcha-bot-source` 和 `onError` 的 `error.source`。

`GET /compat` 不触发状态变更。无效、过期或跨 IP/action 的票据不能标记其他轮次。重置会清理 DOM 中的旧票据，但保留已经识别的组件标记；销毁时移除监听。服务端保存的标记按该轮次的有效期自动到期。

这里的“仅 agent 可见”指读取 DOM 的工具可以发现，而页面视觉和辅助技术不可见；开发者工具同样可以查看。它只捕获执行指令或使用诱饵的自动化程序，不能检测忽略诱饵、重新创建组件或直接调用正常 API 的所有机器人，也无法撤回已经完成的业务操作。它与 PoW、图片挑战和行为分析共同使用。

### API 接口

| 路径 | 访问权限 | 说明 |
| :--- | :--- | :--- |
| `POST /captcha/v1/pow` | 公开 | 携带 `action`、`hints` 获取自适应 PoW；兼容原有 `GET /pow?action=...` |
| `POST /captcha/v1/verify` | 公开 | 提交 PoW，换取图片挑战 |
| `POST /captcha/v1/challenge` | 公开 | 提交回正角度与交互轨迹 |
| `POST /captcha/v1/cancel` | 公开 | 取消并释放题目 |
| `POST /captcha/v1/compat` | 当前轮次票据 | 自动化兼容诱饵：标记所属轮次并返回 `BOT_DETECTED`，不提供绕过验证的能力 |
| `POST /captcha/v1/siteverify` | **Bearer 密钥** | **后端核验并消费 Token** |
| `POST /captcha/v1/intent` | **Bearer 密钥** | 由业务后端签发会话和具体操作绑定的验证凭据 |
| `POST /captcha/v1/reputation` | **Bearer 密钥** | 查询指定访客 IP 的名单命中或风险报告 |
| `GET /health` | 公开 | 服务健康检查 |

### 核心参数 (`createCaptcha` / 环境变量)

| 参数 | 环境变量 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `mode` | `CAPTCHA_MODE` | `'strict'` | 运行模式（`strict` 强制图片挑战） |
| `powBits` | `CAPTCHA_POW_BITS` | `20` | PoW 基础难度 (0~28)，频繁失败动态累加 |
| `tolerance` | `CAPTCHA_TOLERANCE` | `10` | 回正角度容差 (±10°) |
| `minSolveMs` | `CAPTCHA_MIN_SOLVE_MS` | `1000` | 最短求解耗时 (ms)，防脚本瞬发 |
| `tokenTtlMs` | `CAPTCHA_TOKEN_TTL_MS` | `300000` | 令牌有效期 (5 分钟) |
| `rateLimit` | `CAPTCHA_RATE_LIMIT` | `60` / 10m | 单 IP 请求频次上限 |
| `challengeTries` | `CAPTCHA_CHALLENGE_TRIES` | `1` | 每题答案提交次数；过早提交不会消耗次数 |
| `challengeRateLimit` | `CAPTCHA_CHALLENGE_RATE_LIMIT` | `10` / 窗口 | 单 IP 发题预算，取消、答错和更换 action 均不退还 |
| `sessionChallengeRateLimit` | `CAPTCHA_SESSION_CHALLENGE_RATE_LIMIT` | `5` / 窗口 | 已绑定会话的独立发题预算，更换操作 ID 不重置 |
| `requireIntent` | `CAPTCHA_REQUIRE_INTENT` | `false` | 要求后端签发的业务意图凭据；Node 独立服务生产环境默认 true |
| `intentTtlMs` | `CAPTCHA_INTENT_TTL_MS` | `600000` | 整个业务意图的最长有效期，不因重试延长 |
| `requirePrivateImages` | `CAPTCHA_REQUIRE_PRIVATE_IMAGES` | `false` | 强制独立私有题库；Node 独立服务生产环境默认 true |
| `minPrivateImages` | `CAPTCHA_MIN_PRIVATE_IMAGES` | `32` | 私有模式的最少不同图片数量，不是抗识别能力保证 |

### 生产加固与会话绑定

默认每题只允许一次答案提交，错误后组件重新获取题目并重新计算 PoW。发题预算与原有请求限流、同时占用题目数分别执行，窗口共用 `rateWindowMs`；成功、失败、取消和过期都不退还已计入的发题预算。绑定会话后还检查独立的会话预算。Node 多副本必须共享原子存储和 namespace；Workers 的预算在同一真实 IP 所属 Durable Object 内执行，跨 IP 的账号/会话总限额仍由业务后端统一控制。

生产建议同时开启以下配置。Node 独立服务在 `NODE_ENV=production` 且未显式设置对应开关时默认开启；库内嵌和 Workers 为兼容旧接入，需要显式开启。旧客户端未提供意图时返回 `INTENT_REQUIRED`，不能通过自报 `sessionId`、`intentId` 或关闭开关降级。

```dotenv
CAPTCHA_REQUIRE_INTENT=true
CAPTCHA_REQUIRE_PRIVATE_IMAGES=true
CAPTCHA_IMAGES_DIR=./.private-puzzles
CAPTCHA_MIN_PRIVATE_IMAGES=32
```

内嵌时传入 `createCaptcha({ requireIntent: true, requirePrivateImages: true, imagesDir: '/srv/private-puzzles' })`。题库需要至少 32 张不同的独立 PNG；内置题图即使改名、复制目录或改写 PNG 元数据也会被拒绝，重复像素不重复计数。此检查只能排除原样内置图片和完全重复图片，不能证明素材从未公开；独立图片及后续轮换由部署方提供。不要把私有题库放入公开资源、Git 或 npm 包；项目默认忽略 `.private-puzzles/`。Workers 私有题库构建见 [Workers 文档](docs/WORKERS.md)。

业务后端先从当前服务器会话取得 `sessionId`，为实际操作生成并保存 `intentId`，再签发凭据；两者不能直接采用请求 JSON 的值。同一 IP 和有效期内，每个操作最多签发一个 Token。重复签发同一待完成操作会返回原凭据且不延长有效期；签发 Token 或消费后不允许该操作再次发题。Token 的有效期不会超过意图剩余期限。业务后端仍需检查操作状态与幂等性，防止已完成的业务在换 IP、意图过期或服务重启后被重新执行。

```javascript
// 业务同源接口内部执行，保留原有会话、CSRF、账号限流与操作检查。
const binding = {
  ip: getClientIp(req),
  action: 'login',
  sessionId: req.sessionID,
  intentId: req.session.loginIntentId // 由后端生成、保存并关联当前登录操作
};
const { intent } = await captcha.createIntent(binding);
res.json({ intent });

// 业务登录接口内部重新从服务端会话和当前操作取得同一 binding。
const ok = await captcha.consumeToken({ ...binding, token: req.body.captcha_token });
if (!ok) return res.status(400).json({ error: '验证码无效或已过期' });
// 执行业务操作；下一次操作由后端生成新的 intentId。
```

独立服务或 Workers 使用后端密钥调用 `POST /captcha/v1/intent`，请求为 `{ip, action, sessionId, intentId}`，响应为 `{intent, expiresInMs}`；业务提交时，后端向 `/siteverify` 发送 `{token, ip, action, sessionId, intentId}`。未匹配会话、操作或 IP 时核验失败，也不会消费另一个上下文的有效 Token。`/intent` 与 `/siteverify` 同样拒绝浏览器 Origin 请求，密钥只能由业务后端持有。验证码服务不会保存原始会话 ID 或操作 ID，只保存摘要。

```javascript
const captcha = Captcha.render('#captcha', {
  apiUrl: '/captcha/v1', action: 'login', prewarm: false,
  intent: async signal => {
    // 此业务同源接口应验证会话、CSRF，并从后端保存的操作中签发凭据。
    const response = await fetch('/api/login/captcha-intent', {
      method: 'POST', credentials: 'same-origin', signal,
      headers: { 'X-CSRF-Token': csrfToken }
    });
    if (!response.ok) throw new Error('无法开始验证');
    return (await response.json()).intent;
  }
});
```

`intent` 也可直接传入后端返回的字符串。函数形式在 `reset()` 后重新调用，当前轮次换题复用同一凭据；获取过程有请求超时及取消保护。不要把固定字符串用于已经消费完成的下一次操作。新增发题限制触发 `CHALLENGE_RATE_LIMITED`（HTTP 429）；同一操作已签发 Token、已消费、凭据错误或过期时返回 `INTENT_INVALID`。

### 浏览器与请求环境评定

组件在获取 PoW、提交行为和图片答案时采集浏览器提示：`sw/sh`（屏幕）、`vw/vh`（当前布局视口）、`dpr`（像素比）、`tz`（`getTimezoneOffset()` 分钟值）、`timeZone`（IANA 时区名称）、`lang`（语言列表）和输入方式。视口按每次请求重新读取，支持窗口缩放、移动端布局视口和分屏。时区名称与时差按服务端当前日期核对，包含夏令时和非整点时区；不根据语言推断用户地域。

Node HTTP、Express 和 Web Fetch / Workers 适配器从实际请求提取 `User-Agent`、`Accept`、`Accept-Language`、`Sec-Fetch-*` 与 `Sec-CH-UA-Mobile`。请求体伪造的 `requestHeaders` 不会覆盖实际请求头。评定检查自动化 UA 特征、请求元数据矛盾及浏览器语言与请求语言是否有共同语种；缺少 Fetch Metadata、语言区域差异、多语言、隐私设置或单项缺失不会单独拒绝验证。请求头和浏览器提示仍可被自动化程序伪造。

请求频率直接复用真实 IP 的原子限流记录，包含配置窗口内的次数、配额利用率和最近 10 秒的突发次数；窗口短于 10 秒时使用较短窗口。所有 action 共用同 IP 记录，包含当前请求，不采用请求体自报频率。至少累计 12 次请求后，窗口利用率达到 50% 才计入频率风险；突发阈值为 `max(12, ceil(rateLimit * 25%))`。不足 12 次的少量请求不会因频率额外加难度，超过原有配额继续返回 HTTP 429 和 `Retry-After`。

规则风险分范围为 0–100：低于 25 保持原难度，25–49 额外增加 1 位 PoW，50 及以上增加 2 位，与 IP 信誉和失败次数的惩罚叠加，总难度仍不超过 28 位。此分数不是机器人概率。环境差异只调整获取题目时的计算成本，图片答案、行为校验、最短等待和一次性令牌要求继续执行。旧客户端不提供新增提示也可验证，全部来源缺失时报告 `unknown`。

可通过导出的 `assessRequestContext(hints, options)` 单独评定，或通过 `assessChallengeBehavior(input, options)` 一并获取新增的 `browser`、`timezone`、`headers`、`frequency`、`language` 五个维度和 `risk`。`options` 可提供 `requestHeaders`、`frequency`、`nowMs`，便于离线重放；直接嵌入核心时，这些请求头应由业务服务端从真实请求提取。

```javascript
import { assessRequestContext } from '@haitang000/ncaptcha';

const report = assessRequestContext(
  { sw: 1920, sh: 1080, vw: 1200, vh: 800, dpr: 1, tz: 0, timeZone: 'UTC', lang: ['zh-CN'] },
  { requestHeaders: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'zh-CN,zh;q=0.9' }, nowMs: Date.now() }
);
console.log(report.risk); // { score: 0, level: 'low', signals: [], powBits: 0 }
```

PoW、挑战和令牌的服务端状态仅保存数值指标、布尔结果及风险原因，保留本轮最高风险报告，随原记录 TTL 到期；不保存 Cookie、Authorization、原始请求头、时区名称或语言列表。公开验证码响应不返回详细评分。

### IP 信誉检测：Blackbox 与 Cloudflare Tunnel

Node 服务在 `.env` 中配置以下内容，重启后启用。示例适用于 `cloudflared` 与验证码服务在同一台机器；若部署在容器或其他主机，`CAPTCHA_TRUSTED_PROXIES` 应填写服务实际看到的紧邻代理地址。

```dotenv
HOST=127.0.0.1
CAPTCHA_TRUSTED_PROXIES=127.0.0.1,::1
CAPTCHA_CLIENT_IP_HEADER=cf-connecting-ip
CAPTCHA_IP_REPUTATION_PROVIDER=blackbox
```

只对来自可信代理的连接读取 `CF-Connecting-IP`，不采用请求体自报的 IP。不要把源站端口开放为可绕过 Tunnel 的入口。可信代理缺少有效 Cloudflare IP 头时返回 `CLIENT_IP_INVALID`，不会回退到本机 IP 并跳过查询。支持 IPv6；若 Cloudflare 开启 Pseudo IPv4 的 `Overwrite Headers`，使用 `CF-Connecting-IPv6` 恢复真实地址。业务后端核验 Token 时也必须传入同一个真实访客 IP。

Blackbox v1 无需 API Key，按访客 IP 查询 `https://blackbox.ipinfo.app/api/v1/{ip}`。服务未设置检测源且未配置 IPQS 时默认使用 Blackbox；示例明确指定 `blackbox`，即使保留了旧的 IPQS Key 也不会调用 IPQS。查询结果只表示名单是否命中，不提供数值信誉分或具体代理类别：

| 返回值 | 报告字段 | 默认处理 |
| :--- | :--- | :--- |
| `Y` | `status: "ok"`，`listed: true` | PoW 增加 2 位 |
| `N` | `status: "ok"`，`listed: false` | 保持基础难度；未命中不等于安全 |
| `E`、超时、HTTP 错误或无效响应 | `status: "unavailable"`，不提供 `listed` | 继续原有完整验证 |

Blackbox 报告的 `fraudScore` 始终为 `null`、`risk` 为 `unknown`，通过 `listed` 判断命中，不把 `Y` / `N` 硬转换为 100 / 0 分。命中只增加 PoW，不自动封禁。新增难度与本地失败次数的惩罚叠加，总上限仍为 28 位；始终需要完成原有图片和行为验证。Blackbox 服务端自身可能缓存结果最长 30 天，检测能力与更新时效见[官方文档](https://blackbox.ipinfo.app/)。

| `createCaptcha` 参数 | 环境变量 | 默认值 |
| :--- | :--- | :--- |
| `reputationProvider` | `CAPTCHA_IP_REPUTATION_PROVIDER` | `blackbox`；可选 `ipqs`、`off` |
| `blackbox.timeoutMs` | `CAPTCHA_BLACKBOX_TIMEOUT_MS` | 2500ms，覆盖请求和响应体读取 |
| `blackbox.cacheTtlMs` | `CAPTCHA_BLACKBOX_CACHE_TTL_MS` | 3600000ms（一小时） |

单实例内同一 IP 的并发查询合并，缓存使用验证码实例的存储；多副本需共享存储和 namespace。Workers 的 SQLite 缓存可在 Durable Object 重建后继续使用。查询失败缓存最多 30 秒，不立即重试。不同检测源的缓存独立。内网、回环和保留地址跳过外部查询并返回 `skipped`。

查询报告的 HTTP 接口仅供业务后端使用，鉴权密钥与 `/siteverify` 相同；这是验证码服务自己的后端密钥，Blackbox 不需要供应商 Key。浏览器不能查询任意 IP，公开验证码响应也不返回完整风险报告：

```http
POST /captcha/v1/reputation
Authorization: Bearer <CAPTCHA_SECRET>
Content-Type: application/json

{"ip":"8.8.8.8"}
```

Blackbox 查询成功的报告示例（仅展示格式）：

```json
{"provider":"blackbox","ip":"8.8.8.8","status":"ok","listed":true,"fraudScore":null,"risk":"unknown","checkedAt":1793404800000}
```

该查询接口本身不执行拦截，与验证流程共享缓存和单 IP 限流。也可直接调用 `await captcha.checkIpReputation({ ip })`。设置 `CAPTCHA_IP_REPUTATION_PROVIDER=off` 关闭查询，此时返回 `status: "disabled"`。`CAPTCHA_ENABLED=false` 会关闭自动验证和自动信誉检查，但显式查询接口仍可使用。

Workers 本地在 `.dev.vars`、云端在 Worker 的 `vars` 中设置 `CAPTCHA_IP_REPUTATION_PROVIDER=blackbox`，无需添加供应商 Secret。Workers 自动从 Cloudflare 请求头读取真实 IP，无需 Node 的可信代理配置。

IPQS 保留为可选检测源：设置 `CAPTCHA_IP_REPUTATION_PROVIDER=ipqs` 并配置 `IPQS_API_KEY`，或内嵌时使用 `createCaptcha({ reputationProvider: 'ipqs', ipqs: { apiKey } })`。为兼容先前配置，未显式指定检测源而提供 IPQS Key / `ipqs` 对象时自动选用 IPQS。密钥只由服务端持有；Workers 云端使用 `npx wrangler secret put IPQS_API_KEY`。

| `ipqs` 参数 | 环境变量 | 默认值 |
| :--- | :--- | :--- |
| `timeoutMs` | `CAPTCHA_IPQS_TIMEOUT_MS` | 2500ms |
| `cacheTtlMs` | `CAPTCHA_IPQS_CACHE_TTL_MS` | 3600000ms |
| `strictness` | `CAPTCHA_IPQS_STRICTNESS` | 0，允许 0–3 |
| `blockScore` | `CAPTCHA_IPQS_BLOCK_SCORE` | `null`，不自动封禁 |

IPQS 的 `fraud_score` 为 0–100，越高风险越高：75–89 增加 2 位 PoW，90–100 增加 4 位。设置 `CAPTCHA_IPQS_BLOCK_SCORE=90` 可拦截大于等于阈值的 IP，返回 HTTP 403、`IP_REPUTATION_BLOCKED`。超时或额度不足时报告未知并继续完整验证。协议见[IPQS 官方 API 文档](https://www.ipqualityscore.com/documentation/proxy-detection-api/overview)。

---

## 🧪 常用开发命令

```powershell
npm run build            # 构建 dist/ 资源，仅混淆验证相关模块
npm test                 # 运行全部核心测试
npm run test:assessment  # 运行多维行为动力学评测
npm run test:browser     # 运行 Playwright 浏览器端到端测试
```

客户端构建默认使用 [javascript-obfuscator](https://github.com/javascript-obfuscator/javascript-obfuscator) 仅对行为采集（`tracking.js`）、Agent 蜜罐（`agent-trap.js`）和 PoW 调度（`pow.js`、`pow-worker.js`）进行标识符混淆与 Base64 字符串数组编码，覆盖普通脚本、ESM 和 Worker；`build:workers` 与打包发布也自动执行。UI 入口（`index.js`）中的 DOM 渲染、文案、动画和交互流程，以及键盘操作（`keyboard.js`）、样式和 SVG 资源均不参与混淆，仅按原构建流程打包压缩。混淆只增加构建依赖，运行时仍为零依赖，不输出 source map。固定随机种子让相同源码和依赖版本生成相同产物。

SHA-256 热循环保留常规压缩，避免字符串解码拖慢 PoW；混淆不启用 `eval`、反调试、控制流平坦化或自防御，保留 `Captcha.render`、ESM 导出及现有配置和回调。混淆用于提高客户端代码的阅读和分析成本，验证结果仍由服务端校验。
