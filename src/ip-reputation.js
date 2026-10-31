import crypto from 'node:crypto';
import { isIP } from 'node:net';

function validateRequestOptions(config, name) {
  for (const [key, min, max] of [['timeoutMs', 1, 10000], ['cacheTtlMs', 1, 86400000]]) {
    if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max) throw new TypeError(`${name}.${key} 必须是 ${min}–${max} 的整数`);
  }
  if (config.fetch !== undefined && typeof config.fetch !== 'function') throw new TypeError(`${name}.fetch 必须为函数`);
}

export function resolveIpqsOptions(options) {
  if (options === undefined) return undefined;
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('ipqs 必须为配置对象');
  const config = { timeoutMs: 2500, cacheTtlMs: 3600000, strictness: 0, blockScore: null, ...options };
  if (typeof config.apiKey !== 'string' || !config.apiKey.trim() || /\s/.test(config.apiKey) || config.apiKey.length > 1024) throw new TypeError('ipqs.apiKey 必须为非空 API Key');
  validateRequestOptions(config, 'ipqs');
  if (!Number.isInteger(config.strictness) || config.strictness < 0 || config.strictness > 3) throw new TypeError('ipqs.strictness 必须是 0–3 的整数');
  if (config.blockScore !== null && (!Number.isInteger(config.blockScore) || config.blockScore < 0 || config.blockScore > 100)) throw new TypeError('ipqs.blockScore 必须为 null 或 0–100 的整数');
  return config;
}

export function resolveReputationOptions(options) {
  const provider = options.reputationProvider ?? (options.ipqs ? 'ipqs' : 'blackbox');
  if (!['blackbox', 'ipqs', 'off'].includes(provider)) throw new TypeError('reputationProvider 必须为 blackbox、ipqs 或 off');
  // 即使未选用 IPQS，也校验显式提供的配置，避免配置错误被静默忽略。
  const ipqs = resolveIpqsOptions(options.ipqs);
  if (provider === 'off') return { provider };
  if (provider === 'ipqs') {
    if (!ipqs) throw new TypeError('选择 ipqs 时必须配置 ipqs.apiKey / IPQS_API_KEY');
    return { ...ipqs, provider };
  }
  if (options.blackbox !== undefined && (!options.blackbox || typeof options.blackbox !== 'object' || Array.isArray(options.blackbox))) throw new TypeError('blackbox 必须为配置对象');
  const config = { timeoutMs: 2500, cacheTtlMs: 3600000, ...options.blackbox, provider };
  validateRequestOptions(config, 'blackbox');
  return config;
}

export function ipqsOptionsFromEnv(env) {
  const names = { timeoutMs: 'CAPTCHA_IPQS_TIMEOUT_MS', cacheTtlMs: 'CAPTCHA_IPQS_CACHE_TTL_MS', strictness: 'CAPTCHA_IPQS_STRICTNESS', blockScore: 'CAPTCHA_IPQS_BLOCK_SCORE' };
  const configured = Object.values(names).some(name => env[name] !== undefined && env[name] !== '');
  if (!env.IPQS_API_KEY && !configured) return undefined;
  const options = { apiKey: env.IPQS_API_KEY };
  for (const [key, name] of Object.entries(names)) if (env[name] !== undefined && env[name] !== '') options[key] = Number(env[name]);
  return resolveIpqsOptions(options);
}

export function reputationOptionsFromEnv(env) {
  const options = {};
  const ipqs = ipqsOptionsFromEnv(env);
  if (ipqs) options.ipqs = ipqs;
  options.reputationProvider = env.CAPTCHA_IP_REPUTATION_PROVIDER ?? (ipqs ? 'ipqs' : 'blackbox');
  const blackbox = {};
  for (const [key, name] of Object.entries({ timeoutMs: 'CAPTCHA_BLACKBOX_TIMEOUT_MS', cacheTtlMs: 'CAPTCHA_BLACKBOX_CACHE_TTL_MS' })) {
    if (env[name] !== undefined && env[name] !== '') blackbox[key] = Number(env[name]);
  }
  if (Object.keys(blackbox).length) options.blackbox = blackbox;
  resolveReputationOptions(options);
  return options;
}

// 不把内网、保留地址或 IPv6 的接口作用域发送给外部信誉服务。
function isPublicIp(ip) {
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  return isIP(ip) === 6 && !ip.includes('%') && /^[23]/.test(ip) && !ip.startsWith('2001:db8:') && !/^3fff:(:|[0-9a-f]{1,3}:)/.test(ip);
}

export function createIpReputationChecker(config, { store, key, now }) {
  const inFlight = new Map();
  // Workers 的原生 fetch 需要保留 globalThis 接收者。
  const fetcher = config?.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const scope = config.provider === 'ipqs' ? crypto.createHash('sha256').update(`${config.apiKey}:${config.strictness}`).digest('hex').slice(0, 16) : 'v1';
  const empty = (ip, status, reason) => ({ provider: config.provider, ip, status, fraudScore: null, risk: 'unknown', checkedAt: null, ...(reason ? { reason } : {}) });
  async function query(ip) {
    const controller = new AbortController();
    let timer;
    const unavailable = reason => ({ ...empty(ip, 'unavailable', reason), checkedAt: now() });
    const timedOut = new Promise(resolve => { timer = setTimeout(() => { resolve(unavailable('timeout')); controller.abort(); }, config.timeoutMs); });
    const request = (async () => {
      try {
        const url = config.provider === 'blackbox'
          ? new URL(`https://blackbox.ipinfo.app/api/v1/${encodeURIComponent(ip)}`)
          : new URL(`https://ipqualityscore.com/api/json/ip/${encodeURIComponent(config.apiKey)}/${encodeURIComponent(ip)}`);
        if (config.provider === 'ipqs') {
          url.searchParams.set('strictness', String(config.strictness));
          url.searchParams.set('allow_public_access_points', 'true');
        }
        const response = await fetcher(url, { signal: controller.signal, redirect: 'manual', headers: { Accept: config.provider === 'blackbox' ? 'text/plain' : 'application/json' } });
        if (!response.ok) { await response.body?.cancel(); return unavailable('http_error'); }
        if (config.provider === 'blackbox') {
          let verdict;
          try { verdict = (await response.text()).trim(); } catch { return unavailable('invalid_response'); }
          if (verdict === 'E') return unavailable('provider_error');
          if (verdict !== 'Y' && verdict !== 'N') return unavailable('invalid_response');
          // v1 只有是否命中名单，不伪造 IPQS 风险分或代理类别。
          return { ...empty(ip, 'ok'), listed: verdict === 'Y', checkedAt: now() };
        }
        let data;
        try { data = await response.json(); } catch { return unavailable('invalid_response'); }
        if (data?.success === false) return unavailable('provider_error');
        if (data?.success !== true || typeof data.fraud_score !== 'number' || !Number.isFinite(data.fraud_score) || data.fraud_score < 0 || data.fraud_score > 100) return unavailable('invalid_response');
        const flags = {};
        for (const [name, field] of Object.entries({ proxy: 'proxy', vpn: 'vpn', tor: 'tor', recentAbuse: 'recent_abuse', botStatus: 'bot_status' })) {
          if (typeof data[field] === 'boolean') flags[name] = data[field];
        }
        return { provider: 'ipqs', ip, status: 'ok', fraudScore: data.fraud_score, risk: data.fraud_score >= 90 ? 'high' : data.fraud_score >= 75 ? 'medium' : 'low', checkedAt: now(), ...flags };
      } catch { return unavailable('network_error'); } // 不传播含 API Key 的请求 URL 或供应商错误文本。
    })();
    try { return await Promise.race([request, timedOut]); } finally { clearTimeout(timer); }
  }
  async function lookup(ip) {
    const cacheKey = key(config.provider, `${scope}:${ip}`);
    const cached = await store.get(cacheKey);
    if (cached) return cached;
    const result = await query(ip);
    await store.set(cacheKey, result, result.status === 'ok' ? config.cacheTtlMs : Math.min(30000, config.cacheTtlMs));
    return result;
  }
  return async ip => {
    if (config.provider === 'off') return empty(ip, 'disabled');
    if (!isPublicIp(ip)) return empty(ip, 'skipped', 'non_public_ip');
    if (!inFlight.has(ip)) inFlight.set(ip, lookup(ip).finally(() => inFlight.delete(ip)));
    return structuredClone(await inFlight.get(ip));
  };
}
