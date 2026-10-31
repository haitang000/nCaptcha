# Cloudflare Workers

入口为 `workers/index.js`，根目录 `wrangler.jsonc` 提供可直接使用的配置。浏览器 UI 与 HTTP 协议保持一致，Node.js 的接入方式也继续保留。

## 本地运行

```powershell
cd F:\code\CAPTCHA
npm ci
Copy-Item .dev.vars.example .dev.vars
# 编辑 .dev.vars，填写自己的随机 CAPTCHA_SECRET，至少 32 字符。
npm run workers:dev
```

Wrangler 自动构建客户端与题图库。本地默认地址为 `http://127.0.0.1:8789`，健康检查是 `GET /health`。服务仅提供验证码 API 和四个组件资源，根路径 `/` 返回 404。`.dev.vars` 仅供本地使用，已加入忽略规则，不进入分发包。

前端接入：

```html
<div id="captcha"></div>
<script src="https://your-captcha.example/captcha/assets/captcha.js"></script>
<script>
  const captcha = Captcha.render('#captcha', {
    apiUrl: 'https://your-captcha.example/captcha/v1',
    action: 'register',
    // 跨域 Worker 脚本受限时，将 pow-worker.js 放到业务同源目录：
    // workerUrl: '/captcha/pow-worker.js',
  });
  // 在业务表单 submit 中 await captcha.verify()，将 token 交给业务后端。
</script>
```

ES module 地址仍为 `/captcha/assets/captcha.esm.js`；CSS 和 PoW Worker 与脚本同目录。跨域 Worker 加载受限时会回退到主线程分块计算。完整表单接入示例见主 README。

## 部署

在 `wrangler.jsonc` 的 `CAPTCHA_ALLOWED_ORIGINS` 填写业务页面的精确 origin（含协议及非默认端口，无路径或末尾斜杠），多个来源用逗号分隔。保留 `CAPTCHA_STATE` 绑定和 `new_sqlite_classes` 迁移，不要在后续部署中删除既有迁移或随意改类名。

由你执行以下命令配置 Cloudflare 账户与云端密钥：

```powershell
npx wrangler login
npx wrangler secret put CAPTCHA_SECRET
npm run workers:deploy
```

`.dev.vars` 不会代替云端 secret。项目未写入账户 ID、域名或真实凭证。`npm run workers:check` 仅做本地部署构建检查，不发布服务。

兼容日期为 `2026-10-01`，该日期已默认启用 Node.js 兼容能力。实现使用 Workers 支持的 `node:crypto`、`node:net`、`node:buffer`、`node:zlib`，运行时不读本机文件。[Node.js 兼容文档](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)

## 持久状态与核验

公开挑战操作按平台提供的 `CF-Connecting-IP` 路由到对应的 Durable Object。`X-Forwarded-For` 与请求 JSON 中自报的 `ip` 不参与公开接口的客户端识别；缺少有效平台 IP 时拒绝签发。

业务后端使用 `Authorization: Bearer <CAPTCHA_SECRET>` 调用 `/captcha/v1/siteverify`，提交 `{token, ip, action}`。`ip` 是用户真实 IP，不能是业务服务器的出口 IP。业务后端若也在 Cloudflare 上，可从自己的平台请求头取得真实 IP。核验按该 IP 路由到同一对象；用途与 IP 不匹配时无法通过。

PoW、挑战、尝试次数、限流、失败声誉和令牌都保存在 SQLite 中。读改写通过同步事务原子执行，对象重建后仍能恢复。TTL 在访问时检查，并由 Durable Object alarm 清理；没有持续运行的计时器，也未使用最终一致性的 Workers KV 消费令牌。[持久存储说明](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)、[SQLite API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)

不同 IP 使用不同对象，避免所有图片处理集中在一个全局对象。同 IP 的多个组件共用每 IP 限额，每道挑战仍独立取消。一个 Worker 部署对应一个业务。宿主业务的认证、CSRF 和业务限流由接入方保留。

连续操作若得到相同清理时间会复用 alarm 排程，空状态也不重复删除 alarm。alarm 触发、对象重建或排程失败后会重新确认；访问时的 TTL 校验始终执行。

## 题库与资源

构建时解码和缩放 PNG，生成私有 `.workers/puzzles.js` 并编入脚本；挑战仍在服务端执行随机加工、像素旋转与 PNG 编码，答案不会传给浏览器。公开目录仅为 `dist`，通过 `ASSETS` 绑定和文件白名单提供四个客户端文件，后端代码、原始题库和 secret 不在公开目录。[资源绑定说明](https://developers.cloudflare.com/workers/static-assets/binding/)

替换题库时，将自己的 PNG 放到目录中，把 `wrangler.jsonc` 的 `build.command` 改为：

```text
npm run build:workers -- --images-dir ./private-puzzles
```

本地也支持绝对路径；云端 CI 应使用随源码提供的相对目录。无有效 PNG 时构建失败。`CAPTCHA_IMAGES_DIR` 仅适用于 Node 服务，Workers 不读取服务器目录。内置 10 张图片用于示例，均按明确的上下方向线索筛选，可换成自己的题库；来源与筛选标准见 [题图库说明](../assets/puzzles/README.md)。

`wrangler.jsonc.vars` 支持主 README 对应的 `CAPTCHA_*` 字符串配置，包括模式、PoW 难度、TTL、角度容差和限流。`CAPTCHA_SECRET` 使用 secret 设置；修改配置后重新部署。Workers 版没有管理后台。

## 验证

```powershell
npm test
npm run test:workers
npm run test:types
npm run test:types:workers
npm run workers:check
npm run test:package
```

Workers 测试使用本地 workerd/Miniflare 验证持久状态、真实图片挑战、来源控制、按 IP 限流和并发消费，并从浏览器完成实际核验。存储检查只通过测试启用的 Miniflare 调试 API 执行，部署配置未启用该能力。本次适配进行本地验证，实际部署需使用你的 Cloudflare 账户。
