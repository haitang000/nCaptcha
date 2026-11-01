import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessRequestContext, assessChallengeBehavior } from '../src/index.js';
import { pickRequestHeaders } from '../src/request-assessment.js';
import { fixture, ctx, nonceFor, challengeTrajectory } from './helpers.js';

const hints = { dpr: 2, sw: 1920, sh: 1080, vw: 1200, vh: 800, tz: -480, timeZone: 'Asia/Shanghai', lang: ['zh-CN', 'en'], pointer: 'mouse' };
const requestHeaders = { 'user-agent': 'Mozilla/5.0 Chrome/130.0.0.0', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8', accept: '*/*', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' };
const nowMs = Date.UTC(2026, 6, 1);

test('设备、时区、实际头和语言给出可序列化独立维度，缺失来源明确未知', () => {
  const absent = assessRequestContext();
  assert.equal(absent.risk.level, 'unknown'); assert.equal(absent.risk.score, 0);
  assert.ok(Object.values(absent.dimensions).every(d => d.status === 'unavailable'));
  const report = assessRequestContext(hints, { requestHeaders, nowMs });
  assert.equal(report.risk.score, 0);
  assert.equal(report.dimensions.browser.metrics.viewportWidth, 1200);
  assert.equal(report.dimensions.timezone.metrics.offsetConsistent, true);
  assert.equal(report.dimensions.language.metrics.consistent, true);
  assert.equal(report.dimensions.headers.metrics.fetchMetadataConsistent, true);
  assert.equal(report.dimensions.frequency.status, 'unavailable');
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  assert.equal(JSON.stringify(report).includes('Mozilla'), false, '报告不保存原始请求头');
});

test('时区校验使用对应日期的夏令时，支持 UTC 和非整点时区，不按语言推断地域', () => {
  for (const [timeZone, tz, date] of [
    ['America/New_York', 240, nowMs], ['America/New_York', 300, Date.UTC(2026, 0, 1)],
    ['Asia/Kathmandu', -345, nowMs], ['Australia/Eucla', -525, nowMs], ['UTC', 0, nowMs],
  ]) {
    const report = assessRequestContext({ ...hints, timeZone, tz }, { nowMs: date });
    assert.equal(report.dimensions.timezone.metrics.offsetConsistent, true, timeZone);
    assert.equal(report.risk.score, 0, '中文浏览器可以使用任意时区');
  }
  const mismatch = assessRequestContext({ ...hints, tz: 0 }, { nowMs });
  assert.ok(mismatch.risk.signals.includes('TIMEZONE_OFFSET_MISMATCH'));
  const unknown = assessRequestContext({ ...hints, timeZone: 'Unknown/City' }, { nowMs });
  assert.equal(unknown.dimensions.timezone.metrics.nameValid, false);
  assert.ok(unknown.risk.signals.includes('TIMEZONE_UNKNOWN'));
});

test('语言比较允许区域变体、多语言和通配符，排除 q=0，差异单独不拒绝', () => {
  for (const language of ['zh-TW', 'de-DE,en-US;q=0.5', '*;q=0.5']) {
    assert.equal(assessRequestContext(hints, { requestHeaders: { ...requestHeaders, 'accept-language': language } }).dimensions.language.metrics.consistent, true);
  }
  const report = assessRequestContext(hints, { requestHeaders: { ...requestHeaders, 'accept-language': 'zh;q=0,en;q=0.0,de-DE' } });
  assert.equal(report.dimensions.language.metrics.consistent, false);
  assert.equal(report.risk.powBits, 0);
  const behavior = assessChallengeBehavior({ angle: 0, hints, trajectory: challengeTrajectory }, { requestHeaders: { ...requestHeaders, 'accept-language': 'de-DE' } });
  assert.equal(behavior.passed, true); assert.ok(behavior.risk.signals.includes('LANGUAGE_MISMATCH'));
  const noCompare = assessRequestContext(hints, { requestHeaders: { ...requestHeaders, 'accept-language': 'zh;q=0' } });
  assert.equal(noCompare.dimensions.language.metrics.compared, false);
});

test('缩放、移动端布局视口、小窗口、旧客户端及缺少 Fetch Metadata 不会单独加难度', () => {
  for (const overrides of [{ vw: 360, vh: 640 }, { sw: 390, sh: 844, vw: 980, vh: 1800 }, { vw: 0, vh: 0 }, { vw: 8000, vh: 1000 }]) {
    const report = assessRequestContext({ ...hints, ...overrides }, { requestHeaders });
    assert.equal(report.risk.powBits, 0);
  }
  const { vw, vh, timeZone, ...legacy } = hints;
  const report = assessRequestContext(legacy, { requestHeaders: { 'user-agent': 'Firefox', 'accept-language': 'zh' } });
  assert.equal(report.risk.score, 0); assert.equal(report.dimensions.browser.metrics.viewportProvided, false);
  assert.equal(report.dimensions.timezone.metrics.nameProvided, false);
});

test('组合异常评分有上限，缺失信息不增加通过能力，新增结构有界校验', () => {
  const report = assessRequestContext({ ...hints, vw: 90000, vh: 90000, tz: 0, lang: ['de'] }, {
    requestHeaders: { 'user-agent': 'curl/8', 'accept-language': 'zh', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-ch-ua-mobile': 'invalid' },
    frequency: { count: 59, burstCount: 30, limit: 60, windowMs: 600000, burstWindowMs: 10000 }, nowMs,
  });
  assert.equal(report.risk.score, 100); assert.equal(report.risk.powBits, 2);
  for (const override of [{ vw: -1 }, { vh: undefined }, { vw: Infinity }, { vw: 100001 }, { timeZone: 'x'.repeat(101) }, { timeZone: [] }]) {
    assert.throws(() => assessRequestContext({ ...hints, ...override }), TypeError);
  }
  for (const time of [NaN, Infinity, 8.64e15 + 1]) assert.throws(() => assessRequestContext(null, { nowMs: time }), TypeError);
  assert.throws(() => assessRequestContext(null, { frequency: { count: 1, burstCount: 2, limit: 60, windowMs: 600000, burstWindowMs: 10000 } }), TypeError);
  assert.equal(assessRequestContext({ ...hints, lang: ['en-US-u-ca-gregory'] }).risk.score, 0);
});

test('只读取评定请求头，大小有界且不包含认证或代理信息', () => {
  const selected = pickRequestHeaders(new Headers({ 'User-Agent': 'browser', Cookie: 'private', Authorization: 'Bearer secret', 'X-Forwarded-For': '1.1.1.1', 'Accept-Language': 'x'.repeat(3000) }));
  assert.deepEqual(Object.keys(selected).sort(), ['accept-language', 'user-agent']);
  assert.equal(selected['accept-language'].length, 2048);
});

test('服务端使用实际频率快照并按窗口衰减，不能靠请求体改写配额', async t => {
  const f = fixture({ rateLimit: 60 }); t.after(() => f.close());
  for (let i = 0; i < 14; i++) assert.equal((await f.captcha.createPow(ctx)).bits, 3);
  const burst = await f.captcha.createPow({ ...ctx, frequency: { count: 0 }, rateLimit: 100000 });
  assert.equal(burst.bits, 4);
  const record = [...f.records.values()].find(r => r.agentTicket === burst.prefix && r.bits !== undefined);
  assert.equal(record.requestAssessment.dimensions.frequency.metrics.count, 15);
  f.advance(10000);
  assert.equal((await f.captcha.createPow(ctx)).bits, 3, '短时突发窗口过期');
  f.advance(600000);
  assert.equal((await f.captcha.createPow(ctx)).bits, 3, '完整窗口过期');
});

test('并发请求共享原子频率，风险升高后仍执行硬限流和 Retry-After', async t => {
  const f = fixture({ rateLimit: 20 }); t.after(() => f.close());
  const results = await Promise.all(Array.from({ length: 20 }, () => f.captcha.createPow(ctx)));
  assert.equal(results.at(-1).bits, 5);
  await assert.rejects(f.captcha.createPow(ctx), e => e.code === 'RATE_LIMITED' && e.details.retryAfterMs === 600000);
});

test('环境风险增加 PoW 后仍要求原难度凭证、图片行为和一次性令牌，保留本轮最高风险', async t => {
  const f = fixture(); t.after(() => f.close());
  const pow = await f.captcha.createPow({ ...ctx, hints: { ...hints, tz: 0 }, requestHeaders: { 'user-agent': 'curl/8', 'accept-language': 'de' } });
  assert.equal(pow.bits, 5);
  assert.equal(pow.risk, undefined, '公开响应不泄露评分细节');
  const { challenge } = await f.captcha.verifyBehavior({ ...ctx, pow: { prefix: pow.prefix, nonce: nonceFor(pow) } });
  const result = await f.captcha.solveChallenge({ ...ctx, id: challenge.id, angle: -f.answer(challenge.id), trajectory: challengeTrajectory });
  const tokenRecord = [...f.records.values()].find(r => r.issuedAt !== undefined && r.agentTicket === pow.prefix);
  assert.ok(tokenRecord.requestAssessment.risk.score >= 50);
  assert.equal(result.requestAssessment, undefined);
  assert.equal(await f.captcha.consumeToken({ ...ctx, token: result.token }), true);
  assert.equal(await f.captcha.consumeToken({ ...ctx, token: result.token }), false);
  const capped = fixture({ powBits: 28 }); t.after(() => capped.close());
  assert.equal((await capped.captcha.createPow({ ...ctx, requestHeaders: { 'user-agent': 'curl/8' } })).bits, 28);
});
