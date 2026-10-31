import { isIP } from 'node:net';
import { CaptchaError } from './error.js';

export function cloudflareClientIp(header, ipv6) {
  if (typeof header !== 'string' || !isIP(header)) throw new CaptchaError('CLIENT_IP_INVALID', '缺少有效的 Cloudflare 访客 IP', 400);
  // Overwrite Headers 模式用 CF-Connecting-IPv6 保存真实地址。
  if (isIP(header) === 4 && Number(header.split('.')[0]) >= 240) {
    if (typeof ipv6 !== 'string' || isIP(ipv6) !== 6) throw new CaptchaError('CLIENT_IP_INVALID', 'Cloudflare 伪 IPv4 缺少真实 IPv6 地址', 400);
    return normalizeIp(ipv6);
  }
  return normalizeIp(header);
}

// 所有等价 IPv6 写法共用限流、失败声誉和令牌绑定；映射 IPv4 也归一。
export function normalizeIp(ip) {
  if (isIP(ip) !== 6) return ip;
  const [address, zone] = ip.split('%');
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(normalized);
  if (mapped) {
    const parts = mapped.slice(1).map(part => parseInt(part, 16));
    return [parts[0] >> 8, parts[0] & 255, parts[1] >> 8, parts[1] & 255].join('.');
  }
  // 链路本地地址的接口作用域有实际含义，尤其不能在可信代理匹配时丢弃。
  return zone && /^fe[89ab][a-f0-9]:/.test(normalized) ? `${normalized}%${zone}` : normalized;
}
