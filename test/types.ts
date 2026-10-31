import { createCaptcha, createMemoryStore, assessChallengeBehavior, type BehaviorAssessment, type CaptchaStore, type TokenResult } from 'portable-captcha';
import { createHttpHandler, createExpressMiddleware } from 'portable-captcha/http';
import { render, type Widget } from 'portable-captcha/client';
const store: CaptchaStore = createMemoryStore();
const engine = createCaptcha({ store, mode: 'strict', powBits: 20 });
createHttpHandler(engine, { secret: 'x'.repeat(32), allowedOrigins: ['https://example.com'] });
createExpressMiddleware(engine);
const widget: Widget = render(document.body, { requestTimeoutMs: 15000, onSuccess(token) { token.toUpperCase(); }, onStateChange(state) { console.log(state); } });
const context = { ip: '127.0.0.1', action: 'login' };
const assessment: BehaviorAssessment = assessChallengeBehavior({ angle: 0, pointer: 'keyboard', keyboard: { startAngle: 0, events: [{ key: 'Enter', control: 'range', t: 100 }] } }, { elapsedMs: 200 });
const passed: boolean = assessment.passed;
const metric: number | boolean = assessment.dimensions.keyboard.metrics.events;
const pow = await engine.createPow(context);
if (pow.agent) {
  const ticket: string = pow.agent.ticket;
  const token: string = pow.agent.token;
  engine.reportAgent({ ...context, ticket, token, source: 'canary-token' }).catch(() => {});
}
const result = await engine.verifyBehavior({ ...context, pow: { prefix: pow.prefix, nonce: '1' } });
if ('token' in result) { const token: TokenResult = result; await engine.consumeToken({ ...context, token: token.token }); }
else await engine.solveChallenge({ ...context, id: result.challenge.id, angle: 0, pointer: 'mouse', trajectory: [{ x: 1, y: 1, t: 0 }, { x: 3, y: 1, t: 50 }, { x: 4, y: 1, t: 120 }] });
await engine.solveChallenge({ ...context, id: 'a'.repeat(32), angle: 0, pointer: 'keyboard', keyboard: { startAngle: 0, events: [{ key: 'Enter', control: 'range', t: 100 }] } });
await store.update<{ count: number }, number>('test', record => ({ value: { count: (record?.count ?? 0) + 1 }, ttlMs: 1000, result: 1 }));
widget.destroy(); await engine.close(); await store.close?.();
