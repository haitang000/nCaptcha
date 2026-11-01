import { createCaptcha, createMemoryStore, assessChallengeBehavior, assessRequestContext, type BehaviorAssessment, type CaptchaStore, type TokenResult, type RequestAssessment } from 'portable-captcha';
import { createHttpHandler, createExpressMiddleware } from 'portable-captcha/http';
import { render, type Widget } from 'portable-captcha/client';
const store: CaptchaStore = createMemoryStore();
const engine = createCaptcha({ store, mode: 'strict', powBits: 20 });
const blackboxEngine = createCaptcha({ reputationProvider: 'blackbox', blackbox: { timeoutMs: 2500, cacheTtlMs: 3600000 } });
const blackboxRisk = await blackboxEngine.checkIpReputation({ ip: '8.8.8.8' });
const listed: boolean | undefined = blackboxRisk.listed;
await blackboxEngine.close();
const riskEngine = createCaptcha({ ipqs: { apiKey: 'server-only', timeoutMs: 2500, blockScore: 90, strictness: 0 } });
const ipRisk = await riskEngine.checkIpReputation({ ip: '8.8.8.8' });
const fraudScore: number | null = ipRisk.fraudScore;
createHttpHandler(riskEngine, { trustedProxies: ['127.0.0.1'], clientIpHeader: 'cf-connecting-ip' });
await riskEngine.close();
createHttpHandler(engine, { secret: 'x'.repeat(32), allowedOrigins: ['https://example.com'] });
createExpressMiddleware(engine);
const widget: Widget = render(document.body, { requestTimeoutMs: 15000, onSuccess(token) { token.toUpperCase(); }, onStateChange(state) { console.log(state); } });
const context = { ip: '127.0.0.1', action: 'login' };
const assessment: BehaviorAssessment = assessChallengeBehavior({ angle: 0, pointer: 'keyboard', keyboard: { startAngle: 0, events: [{ key: 'Enter', control: 'range', t: 100 }] } }, { elapsedMs: 200 });
const passed: boolean = assessment.passed;
const metric: number | boolean = assessment.dimensions.keyboard.metrics.events;
const requestAssessment: RequestAssessment = assessRequestContext({ dpr: 1, sw: 1920, sh: 1080, vw: 1200, vh: 800, timeZone: 'UTC', tz: 0, lang: ['en'] },
  { requestHeaders: { 'accept-language': 'en-US' }, nowMs: Date.now(), frequency: { count: 1, burstCount: 1, windowMs: 600000, burstWindowMs: 10000, limit: 60 } });
const riskScore: number = requestAssessment.risk.score;
await engine.createPow({ ...context, hints: { dpr: 1, sw: 1920, sh: 1080, tz: 0, lang: ['en'] }, requestHeaders: { 'user-agent': 'browser' } });
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
