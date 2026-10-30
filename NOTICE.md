# 来源与改动

本项目按用户要求从本机 `F:\localhosting` 的 CAPTCHA 实现提取。原项目没有被改动。

- `src/image-codec.js` 与 `src/images.js`：基于原 `src/rotate-image.js` 的像素算法与题图加载逻辑，修正灰度通道、缩放及数据长度校验；Workers 和 Node 共享像素算法。
- `src/signals.js`：保留原 `src/captcha.js` 的轨迹与填写节奏评分，增加边界校验。
- `src/client/hash.js`：提取原 `public/app.js` 的纯 JavaScript SHA-256。
- `assets/puzzles/`：原四张题图，文件内容保持一致。
- 客户端交互和外观沿用原验证按钮、加载动效及图片回正体验，并改为实例隔离和独立样式。
- `workers/`：新增 Cloudflare Workers HTTP 入口与 SQLite Durable Objects 持久存储。Node 与 Workers 共用同一验证码核心，原 Node 公共接口保持兼容。

源项目没有提供可核实的开源许可证，本次提取不新增开源授权声明，也未发布到公共仓库或 npm。
