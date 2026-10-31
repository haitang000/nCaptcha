# 当前 Workers 部署

- Worker：`portable-captcha`
- 公网地址：<https://captcha-workers.haitang000.cn>
- 健康检查：<https://captcha-workers.haitang000.cn/health>
- 验证 API 前缀：`https://captcha-workers.haitang000.cn/captcha/v1`
- 组件脚本：<https://captcha-workers.haitang000.cn/captcha/assets/captcha.js>
- ES module：<https://captcha-workers.haitang000.cn/captcha/assets/captcha.esm.js>
- 备用 Workers 地址：<https://portable-captcha.crashv.workers.dev/health>
- 首次部署版本：`4e91594c-0f05-4d94-9c4d-03a3f537bf1e`
- 绑定自定义域名后的版本：`3f3ad23c-4324-4b0e-aeae-92123fa49d7b`
- 图片挑战 UI 更新版本：`2a2d4268-f0b7-47c4-ae13-322f6094b2e9`（圆形预览、胶囊滑块与六点拖柄，松手自动验证）
- 放大入场动效版本：`32b8a2c3-1c6f-471e-84ba-12dd4a6ade22`（240ms 居中放大淡入，减少动态效果时直接显示）
- 部署使用严格模式、20 位基础 PoW 和 SQLite Durable Objects。

这是独立验证码 API 和可嵌入组件服务。业务页面挂载组件，业务后端持有密钥并通过 `/siteverify` 核验与消费令牌。完整表单示例见主 README。

部署配置已同步 Cloudflare 当前的 `captcha-workers.haitang000.cn` 绑定。`captcha.haitang000.cn` 保留在跨域白名单中，其现有 DNS 记录由外部管理。

## 接入业务网站

在 `wrangler.jsonc` 的 `vars.CAPTCHA_ALLOWED_ORIGINS` 中追加实际业务页面的 origin（含协议和非默认端口，不带路径或末尾斜杠）。当前包含 Worker 自身的 origin 及本地开发地址。

```js
import { render } from 'https://captcha-workers.haitang000.cn/captcha/assets/captcha.esm.js';

const captcha = render('#captcha', {
  apiUrl: 'https://captcha-workers.haitang000.cn/captcha/v1',
  action: 'register',
});
```

业务后端核验地址为 `POST https://captcha-workers.haitang000.cn/captcha/v1/siteverify`。使用 `Authorization: Bearer <CAPTCHA_SECRET>`，JSON 请求体为 `{token, ip, action}`；`ip` 是用户真实 IP。密钥已写入 Cloudflare Secret，本机备份位于 `F:\code\CAPTCHA\.dev.vars` 和 `F:\code\CAPTCHA\.deployment\cloudflare-secrets.json`，这两个文件均被忽略，不应复制到浏览器代码或公开仓库。

## 更新部署

```powershell
cd F:\code\CAPTCHA
npx wrangler deploy --strict
```

常规更新会保留云端已有 Secret。需要同步本机密钥时使用：

```powershell
npx wrangler deploy --strict --secrets-file .deployment/cloudflare-secrets.json
```

部署不依赖本机 Node.js 服务或 cloudflared 进程。本机关闭后，Cloudflare Workers 仍可提供服务。

线上已检查健康接口、四个组件资源、CORS、密钥保护、20 位 PoW、严格模式图片挑战和挑战取消；自定义域名已通过本机 HTTPS 直连检查。
