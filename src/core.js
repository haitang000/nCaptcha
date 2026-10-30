import crypto from 'node:crypto';
import { isIP } from 'node:net';
import { obscurePuzzle, rotateToPng } from './image-codec.js';
import { analyzeTrajectory, analyzeFormBehavior, validSignals } from './signals.js';
import { createMemoryStore } from './store.js';
import { CaptchaError, invalid } from './error.js';
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
export function validateContext({ ip, action = 'default' } = {}) {
  if (typeof ip !== 'string' || !isIP(ip)) throw invalid('ip 必须是有效的 IPv4 或 IPv6 地址');
  if (typeof action !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(action)) throw invalid('action 需为 1–64 位字母、数字或 _ . : -');
  // 将 IPv4 映射地址统一，避免原生 HTTP 与业务框架给出的格式不同。
  if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  return { ip, action };
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
  let mode = config.mode;
  const key = (kind, id) => `${namespace}:${kind}:${id}`;
  const ensureOpen = () => { if (closed) throw new CaptchaError('CLOSED', '验证码实例已关闭', 503); };
  function context(input) { ensureOpen(); if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid(); return validateContext(input); }
  const same = (record, ctx) => record.ip === ctx.ip && record.action === ctx.action;
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
  async function mint(ctx) {
    const token = crypto.randomBytes(32).toString('hex');
    await store.set(key('token', token), { ...ctx, issuedAt: now(), expiresAt: now() + config.tokenTtlMs }, config.tokenTtlMs);
    return { token, expiresInMs: config.tokenTtlMs, usableAfterMs: config.minTokenAgeMs };
  }
  async function release(ip, id) {
    await store.update(key('slots', ip), previous => {
      const list = (previous ?? []).filter(slot => slot.id !== id && slot.expiresAt > now());
      return { value: list.length ? list : undefined, ttlMs: config.challengeTtlMs };
    });
  }
  async function challenge(ctx) {
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
      const image = rotateToPng(obscurePuzzle(pictures[crypto.randomInt(pictures.length)]), answer);
      await store.set(key('challenge', id), { ...ctx, answer, createdAt: now(), expiresAt, tries: config.challengeTries }, config.challengeTtlMs);
      return { challenge: { id, image: `data:image/png;base64,${image.toString('base64')}`, expiresInMs: config.challengeTtlMs } };
    } catch (err) { await release(ctx.ip, id); throw err; }
  }
  return {
    async createPow(input) {
      const ctx = context(input); await throttle(ctx.ip);
      if (!config.enabled) return { prefix: '', bits: 0, expiresInMs: config.powTtlMs };
      const failures = await reputation(ctx.ip);
      const bits = Math.min(28, config.powBits + (failures >= 20 ? 4 : failures >= 8 ? 3 : failures >= 3 ? 2 : 0));
      const prefix = crypto.randomBytes(16).toString('hex');
      await store.set(key('pow', prefix), { ...ctx, bits }, config.powTtlMs);
      return { prefix, bits, expiresInMs: config.powTtlMs };
    },
    async verifyBehavior(input) {
      const ctx = context(input); await throttle(ctx.ip);
      if (!config.enabled) return mint(ctx);
      const { pow, trajectory = null, formBehavior = null, hints = null } = input;
      if (!pow || typeof pow.prefix !== 'string' || !/^[a-f0-9]{32}$/.test(pow.prefix) || typeof pow.nonce !== 'string' || !/^\d{1,32}$/.test(pow.nonce)) throw invalid('PoW 数据格式不正确');
      const accepted = await store.update(key('pow', pow.prefix), record => ({
        value: undefined, result: !!record && same(record, ctx) && zeroBits(crypto.createHash('sha256').update(pow.prefix + pow.nonce).digest()) >= record.bits,
      }));
      if (!accepted) { await reputation(ctx.ip, true); throw new CaptchaError('POW_INVALID', '计算凭证无效或已过期，请重新验证'); }
      if (!validSignals(trajectory, formBehavior, hints)) { await reputation(ctx.ip, true); throw invalid(); }
      if (mode === 'strict' || (!trajectory && !formBehavior)) return challenge(ctx);
      const trajPass = 4 + crypto.randomInt(2), formPass = 3 + crypto.randomInt(2);
      const touch = hints?.coarse || hints?.pointer === 'touch' || hints?.pointer === 'pen';
      const trajectoryPass = !!trajectory && analyzeTrajectory(trajectory, touch) >= trajPass;
      const formPasses = !!formBehavior && analyzeFormBehavior(formBehavior) >= formPass;
      const passed = touch ? trajectoryPass || formPasses : (!trajectory || trajectoryPass) && (!formBehavior || formPasses);
      return passed ? mint(ctx) : challenge(ctx);
    },
    async solveChallenge(input) {
      const ctx = context(input); await throttle(ctx.ip);
      const { id, angle, pointer = 'mouse' } = input;
      if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id) || !Number.isFinite(angle) || Math.abs(angle) > 360000 || !['mouse', 'touch', 'pen', 'keyboard'].includes(pointer)) throw invalid();
      const result = await store.update(key('challenge', id), record => {
        if (!record) return { result: { code: 'CHALLENGE_EXPIRED' } };
        if (!same(record, ctx)) return { result: { code: 'BINDING_MISMATCH', releaseIp: record.ip } };
        if (now() - record.createdAt < config.minSolveMs) return { value: record, ttlMs: record.expiresAt - now(), result: { code: 'TOO_FAST', retryAfterMs: config.minSolveMs - (now() - record.createdAt) } };
        const tolerance = ['touch', 'pen'].includes(pointer) ? Math.min(config.tolerance + 4, 15) : config.tolerance;
        if (Math.abs(angleDiff(angle, -record.answer)) <= tolerance) return { result: { success: true, releaseIp: record.ip } };
        record.tries--;
        return { value: record.tries ? record : undefined, ttlMs: record.expiresAt - now(), result: { code: record.tries ? 'ANGLE_INCORRECT' : 'CHALLENGE_EXHAUSTED', triesRemaining: record.tries, releaseIp: record.tries ? undefined : record.ip } };
      });
      if (result.releaseIp) await release(result.releaseIp, id);
      if (!result.success) { await reputation(ctx.ip, true); throw new CaptchaError(result.code, result.code === 'ANGLE_INCORRECT' ? '方向还未回正，请微调后重试' : result.code === 'TOO_FAST' ? '请稍等再提交' : '挑战无效或已过期，请重新验证', 400, { triesRemaining: result.triesRemaining, retryAfterMs: result.retryAfterMs }); }
      return mint(ctx);
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
      return store.update(key('token', input.token), record => {
        if (!record || !same(record, ctx)) return { result: false };
        if (now() - record.issuedAt < config.minTokenAgeMs) return { value: record, ttlMs: record.expiresAt - now(), result: false };
        return { result: true };
      });
    },
    setMode(value) { ensureOpen(); if (!['normal', 'strict'].includes(value)) throw invalid('mode 只能是 normal 或 strict'); mode = value; },
    async close() { if (closed) return; closed = true; if (!options.store) await store.close(); },
  };
}
