import crypto from 'node:crypto';
import { createCaptcha, createMemoryStore } from '../src/index.js';
export const ctx = { ip: '127.0.0.1', action: 'login' };
export const challengeTrajectory = [
  { x: 100, y: 200, t: 0 }, { x: 105, y: 200, t: 15 }, { x: 125, y: 201, t: 43 },
  { x: 165, y: 200, t: 70 }, { x: 200, y: 201, t: 105 }, { x: 215, y: 200, t: 150 }, { x: 218, y: 200, t: 210 },
];
export function keyboardForAngle(angle) {
  angle = ((angle % 360) + 360) % 360;
  const keys = ['Home', ...Array(Math.floor(angle / 10)).fill('PageUp'), ...Array(angle % 10).fill('ArrowRight'), 'Enter'];
  return { startAngle: 0, events: keys.map((key, i) => ({ key, control: 'range', t: 100 + i * 3 })) };
}
export function fixture(options = {}) {
  let time = 100000;
  const records = new Map();
  const memory = createMemoryStore({ now: () => time, cleanupIntervalMs: 0 });
  const store = { ...memory, async set(key, value, ttl) { records.set(key, structuredClone(value)); return memory.set(key, value, ttl); } };
  const captcha = createCaptcha({ powBits: 3, minSolveMs: 0, minTokenAgeMs: 0, rateLimit: 1000, ...options, store, now: () => time });
  return { captcha, store, records, advance(ms) { time += ms; }, answer(id) { return [...records].find(([key]) => key.endsWith(':challenge:' + id))?.[1].answer; }, async close() { await captcha.close(); await memory.close(); } };
}
export function nonceFor(pow, passes = true) {
  const valid = nonce => {
    const digest = crypto.createHash('sha256').update(pow.prefix + nonce).digest();
    let bits = 0;
    for (const byte of digest) { if (byte === 0) bits += 8; else { bits += Math.clz32(byte) - 24; break; } }
    return bits >= pow.bits;
  };
  let nonce = 0;
  while (valid(String(nonce)) !== passes) nonce++;
  return String(nonce);
}
export async function verify(captcha, context = ctx, signals = {}) {
  const pow = await captcha.createPow(context);
  return captcha.verifyBehavior({ ...context, pow: { prefix: pow.prefix, nonce: nonceFor(pow) }, ...signals });
}
export async function solved(f, context = ctx, pointer = 'mouse') {
  const { challenge } = await verify(f.captcha, context);
  const angle = -f.answer(challenge.id);
  return f.captcha.solveChallenge({ ...context, id: challenge.id, angle, pointer, trajectory: challengeTrajectory, keyboard: pointer === 'keyboard' ? keyboardForAngle(angle) : null });
}
