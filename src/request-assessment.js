import { validSignals } from './signals.js';

const headerNames = ['user-agent', 'accept', 'accept-language', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-ch-ua-mobile'];
const dimension = () => ({ status: 'unavailable', metrics: {} });

// 只提取评定需要的头；不读取 Cookie、Authorization 或转发 IP。
export function pickRequestHeaders(headers) {
  if (headers == null) return undefined;
  const entries = typeof headers.get === 'function' ? headerNames.map(name => [name, headers.get(name)]) : Object.entries(headers);
  const result = {};
  for (const [key, value] of entries) {
    const name = key.toLowerCase();
    if (headerNames.includes(name) && typeof value === 'string') result[name] = value.slice(0, 2048).trim();
  }
  return result;
}

function timezoneOffset(timeZone, nowMs) {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(nowMs).find(p => p.type === 'timeZoneName').value;
    if (part === 'GMT') return 0;
    const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(part);
    return match ? (match[1] === '+' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) || 0 : null;
  } catch { return null; }
}

/** 规则风险分（0–100），不是机器人概率。弱信号只调整 PoW，不单独拒绝真人。 */
export function assessRequestContext(hints = null, { requestHeaders, frequency, nowMs = Date.now(), pointer } = {}) {
  if (!validSignals(null, null, hints)) throw new TypeError('hints 格式不正确');
  if (!Number.isFinite(nowMs) || Math.abs(nowMs) > 8.64e15) throw new TypeError('nowMs 必须为有效时间戳');
  if (frequency && (!Number.isInteger(frequency.count) || frequency.count < 0 || !Number.isInteger(frequency.burstCount) || frequency.burstCount < 0 || frequency.burstCount > frequency.count ||
    !Number.isInteger(frequency.limit) || frequency.limit < 1 || !Number.isFinite(frequency.windowMs) || frequency.windowMs <= 0 ||
    !Number.isFinite(frequency.burstWindowMs) || frequency.burstWindowMs <= 0 || frequency.burstWindowMs > frequency.windowMs)) throw new TypeError('frequency 格式不正确');
  const dimensions = Object.fromEntries(['browser', 'timezone', 'headers', 'frequency', 'language'].map(name => [name, dimension()]));
  const signals = [];
  let score = 0;
  const observe = (name, metrics) => { dimensions[name] = { status: 'info', metrics }; };
  const add = (name, points) => { signals.push(name); score += points; };
  const headers = pickRequestHeaders(requestHeaders);
  if (hints) {
    const { sw, sh, dpr, vw, vh } = hints;
    const viewportProvided = vw !== undefined && vh !== undefined;
    const smallViewport = viewportProvided && (vw < 100 || vh < 100);
    // 允许移动端布局视口、浏览器缩放、分屏及多显示器，不要求视口等于屏幕。
    const oversizedViewport = viewportProvided && (vw > sw * 3 + 200 || vh > sh * 3 + 200);
    const pointerConsistent = pointer === undefined || hints.pointer === undefined || pointer === hints.pointer;
    observe('browser', { screenWidth: sw, screenHeight: sh, pixelRatio: dpr, viewportProvided,
      ...(viewportProvided ? { viewportWidth: vw, viewportHeight: vh, smallViewport, oversizedViewport } : {}), pointerConsistent });
    if (smallViewport) add('VIEWPORT_SMALL', 5);
    if (oversizedViewport) add('VIEWPORT_SCREEN_MISMATCH', 10);
    if (!pointerConsistent) add('POINTER_MISMATCH', 5);
    const expected = hints.timeZone === undefined ? null : timezoneOffset(hints.timeZone, nowMs);
    observe('timezone', { offsetMinutes: hints.tz, nameProvided: hints.timeZone !== undefined,
      ...(hints.timeZone === undefined ? {} : { nameValid: expected !== null }),
      ...(expected === null ? {} : { expectedOffsetMinutes: expected, offsetConsistent: expected === hints.tz }) });
    if (hints.timeZone !== undefined && expected === null) add('TIMEZONE_UNKNOWN', 10);
    if (expected !== null && expected !== hints.tz) add('TIMEZONE_OFFSET_MISMATCH', 20);
  }
  if (headers) {
    const ua = headers['user-agent'] ?? '', language = headers['accept-language'] ?? '';
    const automatedAgent = /headlesschrome|phantomjs|curl\/|wget\/|python-requests|python-httpx|node-fetch|go-http-client|playwright|puppeteer|selenium/i.test(ua);
    const mode = headers['sec-fetch-mode'], dest = headers['sec-fetch-dest'], site = headers['sec-fetch-site'];
    const fetchMetadataConsistent = (mode === undefined || ['cors', 'same-origin', 'no-cors'].includes(mode)) &&
      (dest === undefined || dest === 'empty') && (site === undefined || ['same-origin', 'same-site', 'cross-site', 'none'].includes(site));
    const mobileHintValid = headers['sec-ch-ua-mobile'] === undefined || ['?0', '?1'].includes(headers['sec-ch-ua-mobile']);
    observe('headers', { userAgentPresent: !!ua, acceptLanguagePresent: !!language, acceptPresent: !!headers.accept,
      fetchMetadataPresent: mode !== undefined || dest !== undefined || site !== undefined, fetchMetadataConsistent, mobileHintValid, automatedAgent });
    if (!ua) add('USER_AGENT_MISSING', 5);
    if (!language) add('ACCEPT_LANGUAGE_MISSING', 5);
    if (automatedAgent) add('AUTOMATION_USER_AGENT', 20);
    if (!fetchMetadataConsistent) add('FETCH_METADATA_INCONSISTENT', 20);
    if (!mobileHintValid) add('CLIENT_HINT_INVALID', 5);
  }
  if (hints || headers?.['accept-language']) {
    const accepted = (headers?.['accept-language'] ?? '').split(',').map(value => {
      const [tag, ...parameters] = value.trim().split(';');
      return parameters.some(p => /^\s*q\s*=\s*0(?:\.0*)?\s*$/i.test(p)) ? '' : tag.toLowerCase();
    }).filter(tag => tag === '*' || /^[a-z]{1,8}(?:-[a-z0-9]{1,8})*$/.test(tag));
    const comparable = !!hints && accepted.length > 0;
    const consistent = comparable && (accepted.includes('*') || hints.lang.some(lang => accepted.some(tag => tag.split('-')[0] === lang.toLowerCase().split('-')[0])));
    observe('language', { browserLanguages: hints?.lang.length ?? 0, headerLanguages: accepted.length, compared: comparable,
      ...(comparable ? { consistent } : {}) });
    if (comparable && !consistent) add('LANGUAGE_MISMATCH', 15);
  }
  if (frequency) {
    const { count, burstCount, limit, windowMs, burstWindowMs } = frequency;
    const utilization = count / limit;
    // 同 IP 的正常验证含多次请求；小配额和少量重试不触发额外惩罚。
    const elevated = count >= 12 && utilization >= .5;
    const burst = burstCount >= Math.max(12, Math.ceil(limit * .25));
    observe('frequency', { count, burstCount, limit, windowMs, burstWindowMs, utilization, elevated, burst });
    if (elevated) add('REQUEST_FREQUENCY_HIGH', utilization >= .8 ? 40 : 20);
    if (burst) add('REQUEST_BURST', 25);
  }
  score = Math.min(100, score);
  return { dimensions, risk: { score, level: Object.values(dimensions).every(d => d.status === 'unavailable') ? 'unknown' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low', signals, powBits: score >= 50 ? 2 : score >= 25 ? 1 : 0 } };
}
