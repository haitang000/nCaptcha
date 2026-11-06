import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { CaptchaError, invalid } from './error.js';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function identifiers(input) {
  for (const name of ['sessionId', 'intentId']) {
    if (typeof input[name] !== 'string' || !input[name].length || input[name].length > 256 || /[\x00-\x1f\x7f]/.test(input[name])) throw invalid(`${name} 必须为 1–256 位非控制字符`);
  }
  return { sessionHash: hash(input.sessionId), intentHash: hash(JSON.stringify([input.sessionId, input.intentId])) };
}

export const sameContext = (record, ctx) => !!record && record.ip === ctx.ip && record.action === ctx.action &&
  record.sessionHash === ctx.sessionHash && record.intentHash === ctx.intentHash;

/** 只有业务后端可以签发意图；浏览器携带随机凭据，不能自行指定可信会话。 */
export function createIntents({ store, key, now, ttlMs, required }) {
  const expired = () => new CaptchaError('INTENT_INVALID', '业务验证凭据无效、已使用或已过期', 403);
  return {
    async issue(input, ctx) {
      const binding = identifiers(input);
      const id = hash(JSON.stringify([binding.sessionHash, binding.intentHash, ctx.action]));
      return store.update(key('intent', id), previous => {
        if (previous) {
          if (!sameContext(previous, { ...ctx, ...binding }) || previous.status !== 'pending') throw expired();
          return { value: previous, ttlMs: previous.expiresAt - now(), result: { intent: previous.credential, expiresInMs: previous.expiresAt - now() } };
        }
        const credential = `${id}.${crypto.randomBytes(32).toString('hex')}`;
        return { value: { ...ctx, ...binding, credential, status: 'pending', expiresAt: now() + ttlMs }, ttlMs,
          result: { intent: credential, expiresInMs: ttlMs } };
      });
    },
    async resolve(input, ctx, { allowIssued = false } = {}) {
      if (input.intent === undefined) {
        if (required) throw new CaptchaError('INTENT_REQUIRED', '请先由业务后端签发验证凭据', 403);
        return ctx;
      }
      if (typeof input.intent !== 'string' || !/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(input.intent)) throw expired();
      const record = await store.get(key('intent', input.intent.slice(0, 64)));
      if (!record || (record.status !== 'pending' && !(allowIssued && record.status === 'issued')) || record.ip !== ctx.ip || record.action !== ctx.action ||
        !crypto.timingSafeEqual(Buffer.from(record.credential), Buffer.from(input.intent))) throw expired();
      return { ...ctx, intent: input.intent, sessionHash: record.sessionHash, intentHash: record.intentHash, intentExpiresAt: record.expiresAt };
    },
    expected(input, ctx) {
      if (input.sessionId === undefined && input.intentId === undefined) return ctx;
      return { ...ctx, ...identifiers(input) };
    },
    async markIssued(ctx) {
      if (!ctx.intent) return;
      const accepted = await store.update(key('intent', ctx.intent.slice(0, 64)), record => {
        if (!sameContext(record, ctx) || record.status !== 'pending' || record.credential !== ctx.intent) return { value: record, ttlMs: record ? record.expiresAt - now() : 1, result: false };
        return { value: { ...record, status: 'issued' }, ttlMs: record.expiresAt - now(), result: true };
      });
      if (!accepted) throw expired();
    },
    async consume(record, ctx) {
      if (!record.intent) return !required;
      return !!await store.update(key('intent', record.intent.slice(0, 64)), intent => {
        if (!sameContext(intent, ctx) || intent.status !== 'issued' || intent.credential !== record.intent) return { value: intent, ttlMs: intent ? intent.expiresAt - now() : 1, result: false };
        return { value: { ...intent, status: 'consumed' }, ttlMs: intent.expiresAt - now(), result: true };
      });
    },
  };
}
