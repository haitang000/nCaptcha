# nCaptcha

**nCaptcha** 是一个可自托管、零运行时依赖的人机验证码系统：结合 **前端自适应 SHA-256 工作量证明（PoW）**、**高质感图片回正** 与 **微观轨迹行为动力学分析**。原生支持 Node.js (≥22.5) 与 Cloudflare Workers（SQLite Durable Objects），客户端构建产物仅 4 个极小静态文件。

---

## ⚡ 核心特性

- **多重防御体系**：前端自适应 PoW 难度门槛 + 像素级防侧信道题图回正 + 轨迹行为动力学检验（检测机械恒速、异常停顿与重放）。
- **Agent 指令蜜罐**：在隐藏 DOM 中提供自动化操作指引，遵循指引的 agent 会主动触发机器人标记，服务端拒绝本轮验证。
- **一次性强绑定令牌**：Token 强绑定真实 IP 与 Action，限制最短求解耗时，必须由业务后端 `/siteverify` 消费。
- **现代化组件**：Shadow DOM 隔离，圆形预览、胶囊滑块、自适应深浅色模式，完整支持触控、鼠标与全键盘操作。
- **双端运行环境**：支持 Node.js（原生 HTTP / Express 快速嵌入）与 Cloudflare Workers（边缘 SQLite 强一致状态）。

---

## 🚀 快速开始

### 方式 1：让 AI Agent 协助部署与接入（推荐）

如果你正在使用 Cursor、Claude Code、Copilot 或 Antigravity 等 AI 编程助手，可直接复制以下提示词发送给 Agent，让其自动分析当前项目并完成端到端接入：

> **📋 复制发给 AI Agent 的 Prompt：**
>
> ```markdown
> 你是一名资深安全与全栈工程师。请帮我在当前项目中集成 nCaptcha 人机验证码。该项目尚未发布到 npm 公共仓库，请按以下步骤执行：
>
> 1. **获取源码与构建**：
>    - 在项目中克隆仓库：`git clone https://github.com/haitang000/nCaptcha.git`
>    - 进入目录并完成构建：`cd nCaptcha && npm ci && npm run build`（构建出前端所需的 `dist/` 资源）
> 2. **接入方式选型**：
>    - **Node.js 内嵌模式**：在主项目中执行 `npm install ./nCaptcha` 本地安装依赖，使用 `createExpressMiddleware` 或原生 HTTP 中间件挂载 `/captcha` 路由与静态资源；
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
import { createCaptcha } from 'portable-captcha';
import { createExpressMiddleware, getClientIp } from 'portable-captcha/http';

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

组件会自动在 `.captcha-host` 的 light DOM 内放置中英文 agent 指令与空的 `input[data-captcha-agent]`，普通界面、Tab 顺序和无障碍树均不显示。指令要求 agent 将字段设为 `automated-agent`，触发 `input`、`change` 事件，再启动验证。字段没有 `name`，不会随业务表单提交，也无需修改业务接入代码。

触发后，宿主出现 `data-captcha-bot="true"`，后续 `/verify` 和 `/challenge` 请求携带 `agentSignal`。服务端返回 HTTP 403、`code: "BOT_DETECTED"`、`bot: true`，不签发令牌，并消费本轮 PoW 或挑战，防止清空字段后重放。组件的 `reset()` 保留标记，`getToken()` 返回 `null`，`onError` 可通过 `error.code` 识别拒绝原因；同 IP 的其他验证不会因此一并被封禁。

这里的“仅 agent 可见”指读取 DOM 的工具可以发现，而页面视觉和辅助技术不可见；开发者工具同样可以查看。它只捕获执行指令或填充蜜罐的自动化程序，不能检测忽略指令、重新创建组件或直接调用 API 的所有机器人，也不会撤销此前已经签发的服务端令牌。它与 PoW、图片挑战和行为分析共同使用。

### API 接口

| 路径 | 访问权限 | 说明 |
| :--- | :--- | :--- |
| `GET /captcha/v1/pow?action=...` | 公开 | 获取 PoW 题目 |
| `POST /captcha/v1/verify` | 公开 | 提交 PoW，换取图片挑战 |
| `POST /captcha/v1/challenge` | 公开 | 提交回正角度与交互轨迹 |
| `POST /captcha/v1/cancel` | 公开 | 取消并释放题目 |
| `POST /captcha/v1/siteverify` | **Bearer 密钥** | **后端核验并消费 Token** |
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

---

## 🧪 常用开发命令

```powershell
npm run build            # 构建客户端资源 (dist/)
npm test                 # 运行全部核心测试
npm run test:assessment  # 运行多维行为动力学评测
npm run test:browser     # 运行 Playwright 浏览器端到端测试
```
