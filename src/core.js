import crypto from 'node:crypto';
import { isIP } from 'node:net';
import { obscurePuzzle, rotatePuzzleToPng } from './image-codec.js';
import { validSignals } from './signals.js';
import { assessChallengeBehavior } from './assessment.js';
import { normalizeIp } from './ip.js';
import { createMemoryStore } from './store.js';
import { CaptchaError, invalid } from './error.js';
import { createAgentLures, botDetected } from './agent-lures.js';
import { createIpReputationChecker, resolveReputationOptions } from './ip-reputation.js';
export { createMemoryStore, CaptchaError };

const defaults = Object.freeze({
  enabled: true, mode: 'strict', powBits: 20, tolerance: 10, minSolveMs: 1000,
  minTokenAgeMs: 300, tokenTtlMs: 300000, challengeTtlMs: 300000, powTtlMs: 120000,
  maxChallengesPerIp: 3, challengeTries: 3, rateLimit: 60, rateWindowMs: 600000,
});
export function angleDiff(a, b) { return ((a - b) % 360 + 540) % 360 - 180; }
function zeroBits(bytes) {
  let n = 0;
  for (const byte of bytes) { if (!byte) n += 8; else { n += Math.clz32(byte) - 24; break; } }
  return n;
}
function hasAgentSignal(input) {
  if (input.agentSignal === undefined) return false;
  if (typeof input.agentSignal !== 'string' || input.agentSignal.length > 64) throw invalid('agentSignal 需为不超过 64 位的字符串');
  return input.agentSignal.length > 0;
}
export function validateContext({ ip, action = 'default' } = {}) {
  if (typeof ip !== 'string' || !isIP(ip)) throw invalid('ip 必须是有效的 IPv4 或 IPv6 地址');
  if (typeof action !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(action)) throw invalid('action 需为 1–64 位字母、数字或 _ . : -');
  return { ip: normalizeIp(ip), action };
}

export function resolveCaptchaOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('配置必须为对象');
  const config = { ...defaults, ...options };
  const ranges = {
    powBits: [0, 28], tolerance: [1, 30], minSolveMs: [0, 600000], minTokenAgeMs: [0, 600000],
    tokenTtlMs: [1, 86400000], challengeTtlMs: [1, 86400000], powTtlMs: [1, 86400000],
    maxChallengesPerIp: [1, 100], challengeTries: [1, 10], rateLimit: [1, 100000], rateWindowMs: [1, 86400000],
  };
  for (const [key, [min, max]] of Object.entries(ranges)) if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max) throw new TypeError(`${key} 必须是 ${min}–${max} 的整数`);
  if (typeof config.enabled !== 'boolean' || !['strict', 'normal'].includes(config.mode)) throw new TypeError('enabled 或 mode 配置不正确');
  if (config.minTokenAgeMs >= config.tokenTtlMs || config.minSolveMs >= config.challengeTtlMs) throw new TypeError('最短等待必须小于对应有效期');
  config.ipReputation = resolveReputationOptions(config);
  return config;
}

export function createCaptchaCore(options = {}, loadPictures) {
  const config = resolveCaptchaOptions(options);
  const now = options.now ?? Date.now;
  if (typeof now !== 'function') throw new TypeError('now 必须为函数');
  const namespace = options.namespace ?? crypto.randomBytes(12).toString('hex');
  if (typeof namespace !== 'string' || !namespace || namespace.length > 128) throw new TypeError('namespace 配置不正确');
  const store = options.store ?? createMemoryStore({ now });
  for (const method of ['get', 'set', 'delete', 'update']) if (typeof store[method] !== 'function') throw new TypeError(`存储缺少 ${method} 方法`);
  const pictures = config.enabled ? loadPictures() : [];
  if (config.enabled && !pictures.length) { if (!options.store) void store.close(); throw new Error('未找到可解码的 PNG 题图，请检查 imagesDir'); }
  let closed = false;
  const key = (kind, id) => `${namespace}:${kind}:${id}`;
  const checkIp = createIpReputationChecker(config.ipReputation, { store, key, now });
  const ensureOpen = () => { if (closed) throw new CaptchaError('CLOSED', '验证码实例已关闭', 503); };
  function context(input) { ensureOpen(); if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid(); return validateContext(input); }
  const same = (record, ctx) => record.ip === ctx.ip && record.action === ctx.action;
  const agentLures = createAgentLures({ ...config, store, key, now, onDetect: async record => {
    await store.delete(key('pow', record.ticket));
    if (record.challengeId) {
      const removed = await store.update(key('challenge', record.challengeId), challenge =>
        challenge?.agentTicket === record.ticket
          ? { value: { ...challenge, agentDetected: record.source }, ttlMs: challenge.expiresAt - now(), result: true }
          : { value: challenge, ttlMs: challenge ? challenge.expiresAt - now() : 1, result: false });
      if (removed) await release(record.ip, record.challengeId);
    }
    await reputation(record.ip, true);
  } });
  async function reputation(ip, failed = false) {
    return store.update(key('reputation', ip), previous => {
      const list = (previous ?? []).filter(t => now() - t < 600000);
      if (failed) list.push(now());
      return { value: list.length ? list.slice(-40) : undefined, ttlMs: 600000, result: list.length };
    });
  }
  async function throttle(ip) {
    const retryAfterMs = await store.update(key('rate', ip), previous => {
      const list = (previous ?? []).filter(t => now() - t < config.rateWindowMs);
      const wait = list.length >= config.rateLimit ? Math.max(1, list[0] + config.rateWindowMs - now()) : 0;
      if (!wait) list.push(now());
      return { value: list, ttlMs: config.rateWindowMs, result: wait };
    });
    if (retryAfterMs) throw new CaptchaError('RATE_LIMITED', '验证请求过于频繁，请稍后再试', 429, { retryAfterMs });
  }
  async function mint(ctx, agentTicket) {
    if (config.enabled) await enforceIp(ctx);
    const agent = await agentLures.advance(ctx, agentTicket, config.tokenTtlMs);
    const token = crypto.randomBytes(32).toString('hex');
    await store.set(key('token', token), { ...ctx, agentTicket, issuedAt: now(), expiresAt: now() + config.tokenTtlMs }, config.tokenTtlMs);
    return { token, expiresInMs: config.tokenTtlMs, usableAfterMs: config.minTokenAgeMs, ...(agent ? { agent } : {}) };
  }
  async function release(ip, id) {
    await store.update(key('slots', ip), previous => {
      const list = (previous ?? []).filter(slot => slot.id !== id && slot.expiresAt > now());
      return { value: list.length ? list : undefined, ttlMs: config.challengeTtlMs };
    });
  }
  async function enforceIp(ctx) {
    const result = await checkIp(ctx.ip);
    if (result.status === 'ok' && result.provider === 'ipqs' && config.ipReputation.blockScore !== null && result.fraudScore >= config.ipReputation.blockScore) {
      throw new CaptchaError('IP_REPUTATION_BLOCKED', '当前网络风险较高，请更换网络后重试', 403);
    }
    return result;
  }
  async function challenge(ctx, agentTicket) {
    const id = crypto.randomBytes(16).toString('hex');
    const expiresAt = now() + config.challengeTtlMs;
    const reserved = await store.update(key('slots', ctx.ip), previous => {
      const list = (previous ?? []).filter(slot => slot.expiresAt > now());
      const allowed = list.length < config.maxChallengesPerIp;
      if (allowed) list.push({ id, expiresAt });
      return { value: list, ttlMs: config.challengeTtlMs, result: allowed };
    });
    if (!reserved) throw new CaptchaError('CHALLENGE_LIMIT', '未解挑战数量已达上限，请取消旧挑战或稍后重试', 429);
    try {
      const answer = crypto.randomInt(360);
      const image = rotatePuzzleToPng(obscurePuzzle(pictures[crypto.randomInt(pictures.length)]), answer);
      await store.set(key('challenge', id), { ...ctx, agentTicket, answer, createdAt: now(), expiresAt, tries: config.challengeTries }, config.challengeTtlMs);
      const agent = await agentLures.advance(ctx, agentTicket, config.challengeTtlMs, id);
      return { challenge: { id, image: `data:image/png;base64,${image.toString('base64')}`, expiresInMs: config.challengeTtlMs, ...(agent ? { agent } : {}) } };
    } catch (err) { await store.delete(key('challenge', id)); await release(ctx.ip, id); throw err; }
  }
  return {
    async checkIpReputation(input) {
      const ctx = context(input); await throttle(ctx.ip);
      return checkIp(ctx.ip);
    },
    async createPow(input) {
      const ctx = context(input); await throttle(ctx.ip);
      if (!config.enabled) return { prefix: '', bits: 0, expiresInMs: config.powTtlMs };
      const ipRisk = await enforceIp(ctx);
      const failures = await reputation(ctx.ip);
      const riskBits = ipRisk.listed === true ? 2 : ipRisk.risk === 'high' ? 4 : ipRisk.risk === 'medium' ? 2 : 0;
      const bits = Math.min(28, config.powBits + riskBits + (failures >= 20 ? 4 : failures >= 8 ? 3 : failures >= 3 ? 2 : 0));
      const prefix = crypto.randomBytes(16).toString('hex');
      const agent = await agentLures.issue(ctx, prefix);
      await store.set(key('pow', prefix), { ...ctx, bits, agentTicket: prefix }, config.powTtlMs);
      return { prefix, bits, expiresInMs: config.powTtlMs, agent };
    },
    async reportAgent(input) {
      const ctx = context(input); await throttle(ctx.ip);
      const record = await agentLures.mark(ctx, input.ticket, input.source, { token: input.token });
      throw botDetected(record.source);
    },
    async verifyBehavior(input) {
      const ctx = context(input); await throttle(ctx.ip);
      const agentDetected = hasAgentSignal(input);
      if (!config.enabled && !agentDetected) return mint(ctx);
      if (!config.enabled) { await reputation(ctx.ip, true); throw botDetected(); }
      const { pow, trajectory = null, formBehavior = null, hints = null } = input;
      if (!pow || typeof pow.prefix !== 'string' || !/^[a-f0-9]{32}$/.test(pow.prefix) || typeof pow.nonce !== 'string' || !/^\d{1,32}$/.test(pow.nonce)) throw invalid('PoW 数据格式不正确');
      const accepted = await store.update(key('pow', pow.prefix), record => ({
        value: undefined, result: record && same(record, ctx) && zeroBits(crypto.createHash('sha256').update(pow.prefix + pow.nonce).digest()) >= record.bits ? record : null,
      }));
      if (!accepted) {
        const source = await agentLures.source(ctx, pow.prefix);
        if (source) throw botDetected(source);
        await reputation(ctx.ip, true); throw new CaptchaError('POW_INVALID', '计算凭证无效或已过期，请重新验证');
      }
      // 先消费已绑定的 PoW；去掉蜜罐字段也不能重放本轮凭证。
      if (agentDetected) { await reputation(ctx.ip, true); throw botDetected(); }
      if (!validSignals(trajectory, formBehavior, hints)) { await reputation(ctx.ip, true); throw invalid(); }
      await enforceIp(ctx);
      // 行为数据全部由客户端自报，不能单独作为签发凭据；normal 保留为兼容别名。
      return challenge(ctx, accepted.agentTicket);
    },
    async solveChallenge(input) {
      const ctx = context(input); await throttle(ctx.ip);
      const agentDetected = hasAgentSignal(input);
      const { id, angle, pointer = 'mouse', trajectory = null, hints = null, keyboard = null } = input;
      if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id) || !Number.isFinite(angle) || Math.abs(angle) > 360000 || !['mouse', 'touch', 'pen', 'keyboard'].includes(pointer)) throw invalid();
      if (!agentDetected && !validSignals(trajectory, null, hints)) { await reputation(ctx.ip, true); throw invalid(); }
      const result = await store.update(key('challenge', id), record => {
        if (!record) return { result: { code: 'CHALLENGE_EXPIRED' } };
        if (!same(record, ctx)) return { result: { code: 'BINDING_MISMATCH', releaseIp: record.ip } };
        if (record.agentDetected) return { value: record, ttlMs: record.expiresAt - now(), result: { code: 'BOT_DETECTED', source: record.agentDetected } };
        if (agentDetected) return { result: { code: 'BOT_DETECTED', releaseIp: record.ip } };
        if (now() - record.createdAt < config.minSolveMs) return { value: record, ttlMs: record.expiresAt - now(), result: { code: 'TOO_FAST', retryAfterMs: config.minSolveMs - (now() - record.createdAt) } };
        const tolerance = config.tolerance;
        const elapsedMs = now() - record.createdAt;
        const behaviorPasses = assessChallengeBehavior({ angle, pointer, trajectory, hints, keyboard }, { elapsedMs }).passed;
        if (behaviorPasses && Math.abs(angleDiff(angle, -record.answer)) <= tolerance) return { result: { success: true, releaseIp: record.ip, agentTicket: record.agentTicket } };
        record.tries--;
        const code = !record.tries ? 'CHALLENGE_EXHAUSTED' : behaviorPasses ? 'ANGLE_INCORRECT' : 'BEHAVIOR_REJECTED';
        return { value: record.tries ? record : undefined, ttlMs: record.expiresAt - now(), result: { code, triesRemaining: record.tries, releaseIp: record.tries ? undefined : record.ip } };
      });
      if (result.releaseIp) await release(result.releaseIp, id);
      if (!result.success) {
        // 正常松手可能早于最低等待时间；保留限流，但不把等待重试记作验证失败。
        if (result.code !== 'TOO_FAST' && !result.source) await reputation(ctx.ip, true);
        if (result.code === 'BOT_DETECTED') throw botDetected(result.source);
        const message = { ANGLE_INCORRECT: '方向还未回正，请微调后重试', BEHAVIOR_REJECTED: '操作轨迹异常，请重新拖动完成验证', TOO_FAST: '请稍等再提交' }[result.code] ?? '挑战无效或已过期，请重新验证';
        throw new CaptchaError(result.code, message, 400, { triesRemaining: result.triesRemaining, retryAfterMs: result.retryAfterMs });
      }
      return mint(ctx, result.agentTicket);
    },
    async cancelChallenge(input) {
      const ctx = context(input); await throttle(ctx.ip);
      if (typeof input.id !== 'string' || !/^[a-f0-9]{32}$/.test(input.id)) throw invalid();
      const removed = await store.update(key('challenge', input.id), record => same(record ?? {}, ctx)
        ? { result: true } : { value: record, ttlMs: record ? record.expiresAt - now() : 1, result: false });
      if (removed) await release(ctx.ip, input.id);
      return removed;
    },
    async consumeToken(input) {
      const ctx = context(input);
      if (typeof input.token !== 'string' || !/^[a-f0-9]{64}$/.test(input.token)) return false;
      if (await agentLures.consumeCanary(ctx, input.token)) return false;
      const result = await store.update(key('token', input.token), record => {
        if (!record) return { result: false };
        // A mismatched IP/action must not invalidate a token bound to another context.
        if (!same(record, ctx)) return { value: record, ttlMs: record.expiresAt - now(), result: false };
        if (now() - record.issuedAt < config.minTokenAgeMs) return { value: record, ttlMs: record.expiresAt - now(), result: false };
        return { result: { agentTicket: record.agentTicket } };
      });
      return !!result && agentLures.allowed(ctx, result.agentTicket);
    },
    setMode(value) { ensureOpen(); if (!['normal', 'strict'].includes(value)) throw invalid('mode 只能是 normal 或 strict'); },
    async close() { if (closed) return; closed = true; if (!options.store) await store.close(); },
  };
}
