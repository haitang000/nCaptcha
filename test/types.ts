import { createCaptcha, createMemoryStore, type CaptchaStore, type TokenResult } from 'portable-captcha';
import { createHttpHandler, createExpressMiddleware } from 'portable-captcha/http';
import { render, type Widget } from 'portable-captcha/client';
const store: CaptchaStore = createMemoryStore();
const engine = createCaptcha({ store, mode: 'strict', powBits: 20 });
createHttpHandler(engine, { secret: 'x'.repeat(32), allowedOrigins: ['https://example.com'] });
createExpressMiddleware(engine);
const widget: Widget = render(document.body, { onSuccess(token) { token.toUpperCase(); }, onStateChange(state) { console.log(state); } });
const context = { ip: '127.0.0.1', action: 'login' };
const pow = await engine.createPow(context);
const result = await engine.verifyBehavior({ ...context, pow: { prefix: pow.prefix, nonce: '1' } });
if ('token' in result) { const token: TokenResult = result; await engine.consumeToken({ ...context, token: token.token }); }
await store.update<{ count: number }, number>('test', record => ({ value: { count: (record?.count ?? 0) + 1 }, ttlMs: 1000, result: 1 }));
widget.destroy(); await engine.close(); await store.close?.();
