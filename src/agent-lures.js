import crypto from 'node:crypto';
import { CaptchaError, invalid } from './error.js';

export const agentSources = ['fastpass', 'compat-event', 'canary-token', 'fallback-api'];
export const botDetected = source => new CaptchaError('BOT_DETECTED', '已检测到自动化代理，验证被拒绝', 403, { bot: true, ...(source ? { source } : {}) });

/** 票据与假令牌仅能标记所属轮次，绝不能作为授权凭据。 */
export function createAgentLures({ store, key, now, powTtlMs, challengeTtlMs, tokenTtlMs, onDetect }) {
  const same = (record, ctx) => record?.ip === ctx.ip && record.action === ctx.action;
  function validate(record, ctx) {
    if (!record) throw new CaptchaError('AGENT_TICKET_INVALID', '验证票据无效或已过期');
    if (!same(record, ctx)) throw new CaptchaError('BINDING_MISMATCH', '验证票据绑定不匹配', 403);
  }
  const descriptor = record => ({ ticket: record.ticket, token: record.token, expiresInMs: Math.max(1, record.expiresAt - now()) });
  async function mark(ctx, ticket, source, { token, strict = true } = {}) {
    if (typeof ticket !== 'string' || !/^[a-f0-9]{32}$/.test(ticket) || !agentSources.includes(source)) throw invalid('验证票据或来源不正确');
    const result = await store.update(key('agent', ticket), record => {
      if (!record || !same(record, ctx)) {
        if (strict) validate(record, ctx);
        return { value: record, ttlMs: record ? record.expiresAt - now() : 1, result: null };
      }
      if (source === 'canary-token' && token !== record.token) throw invalid('预计算令牌不正确');
      const first = !record.detected;
      if (first) { record.detected = true; record.source = source; }
      return { value: record, ttlMs: record.expiresAt - now(), result: { record, first } };
    });
    if (result?.first) await onDetect(result.record);
    return result?.record ?? null;
  }
  return {
    async issue(ctx, ticket) {
      const record = { ...ctx, ticket, token: crypto.randomBytes(32).toString('hex'), expiresAt: now() + powTtlMs, detected: false };
      await store.set(key('agent', ticket), record, powTtlMs);
      // 索引覆盖最长流程；轮次本身按 PoW / 图片 / 令牌阶段分别到期。
      try { await store.set(key('canary', record.token), { ...ctx, ticket }, powTtlMs + challengeTtlMs + tokenTtlMs); }
      catch (error) { await store.delete(key('agent', ticket)); throw error; }
      return descriptor(record);
    },
    async advance(ctx, ticket, ttlMs, challengeId) {
      if (!ticket) return undefined; // 兼容更新前已签发的凭据。
      return store.update(key('agent', ticket), record => {
        validate(record, ctx);
        if (record.detected) throw botDetected(record.source);
        record.expiresAt = now() + ttlMs;
        if (challengeId) record.challengeId = challengeId;
        return { value: record, ttlMs, result: descriptor(record) };
      });
    },
    async allowed(ctx, ticket) {
      if (!ticket) return true;
      const record = await store.get(key('agent', ticket));
      return same(record, ctx) && !record.detected;
    },
    async source(ctx, ticket) {
      const record = await store.get(key('agent', ticket));
      return same(record, ctx) && record.detected ? record.source : undefined;
    },
    mark,
    async consumeCanary(ctx, token) {
      const canary = await store.get(key('canary', token));
      if (!same(canary, ctx)) return false;
      await mark(ctx, canary.ticket, 'canary-token', { token, strict: false });
      return true;
    },
  };
}
