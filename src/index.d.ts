/** normal 已弃用，作为 strict 的兼容别名；启用时始终要求图片挑战。 */
export type Mode = 'normal' | 'strict';
export type Pointer = 'mouse' | 'touch' | 'pen' | 'keyboard';
export interface Context { ip: string; action?: string }
/** Blackbox 通过 listed 表示名单命中；只有 IPQS 提供数值风险分。 */
export interface IpReputation {
  provider: 'blackbox' | 'ipqs' | 'off'; ip: string;
  status: 'ok' | 'disabled' | 'skipped' | 'unavailable';
  fraudScore: number | null; risk: 'low' | 'medium' | 'high' | 'unknown'; checkedAt: number | null;
  /** 仅 Blackbox 成功查询时提供；false 表示未命中，不表示确定安全。 */
  listed?: boolean;
  proxy?: boolean; vpn?: boolean; tor?: boolean; recentAbuse?: boolean; botStatus?: boolean;
  reason?: 'non_public_ip' | 'timeout' | 'http_error' | 'provider_error' | 'invalid_response' | 'network_error';
}
export interface BlackboxOptions {
  /** 默认 2500ms，最长 10000ms，涵盖连接与读取响应。 */
  timeoutMs?: number;
  /** 成功结果默认缓存一小时，失败缓存最多 30 秒。 */
  cacheTtlMs?: number;
  fetch?: typeof globalThis.fetch;
}
export interface IpqsOptions extends BlackboxOptions {
  apiKey: string;
  strictness?: 0 | 1 | 2 | 3;
  /** 默认 null，只增加 PoW；设置后拒绝大于等于阈值的 IP。 */
  blockScore?: number | null;
}
/** 隐藏 DOM 蜜罐字段；非空表示自动化代理，返回 BOT_DETECTED 并拒绝本次验证。 */
export interface AgentSignal { agentSignal?: string }
export interface Point { x: number; y: number; t: number }
export interface KeyboardBehavior { startAngle: number; events: { key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'PageUp' | 'PageDown' | 'Home' | 'End' | 'Enter'; control: 'range' | 'stage'; t: number }[] }
export interface FormBehavior { totalMs: number; focusOrder: string[]; fields: Record<string, { n: number; meanGap: number; varGap: number }> }
export interface Hints { dpr: number; sw: number; sh: number; tz: number; lang: string[]; vw?: number; vh?: number; timeZone?: string; pointer?: Pointer; coarse?: boolean }
export type RequestDimension = 'browser' | 'timezone' | 'headers' | 'frequency' | 'language';
export type BehaviorDimension = 'integrity' | 'timing' | 'motion' | 'dynamics' | 'rhythm' | 'keyboard' | 'environment' | 'form' | RequestDimension;
export interface AssessmentDimension { status: 'pass' | 'fail' | 'info' | 'unavailable'; metrics: Record<string, number | boolean> }
/** 服务端原子限流的窗口快照，包含当前请求；不能采用客户端自报值。 */
export interface RequestFrequency { count: number; burstCount: number; windowMs: number; burstWindowMs: number; limit: number }
/** 从实际请求中提取；HTTP 适配器忽略请求体伪造的 requestHeaders。 */
export interface RequestMetadata { requestHeaders?: Record<string, string | undefined> }
export interface RequestAssessmentOptions extends RequestMetadata { frequency?: RequestFrequency; nowMs?: number; pointer?: Pointer }
export interface RequestRisk { score: number; level: 'unknown' | 'low' | 'medium' | 'high'; signals: string[]; powBits: number }
export interface RequestAssessment { dimensions: Record<RequestDimension, AssessmentDimension>; risk: RequestRisk }
/** 缺失信息保持中性；规则分不是机器人概率，建议 PoW 额外增加 0–2 位。 */
export function assessRequestContext(hints?: Hints | null, options?: RequestAssessmentOptions): RequestAssessment;
export interface BehaviorAssessment {
  /** 仅表示行为检查通过，不表示图片答案正确或真人概率。 */
  passed: boolean;
  reasons: string[];
  dimensions: Record<BehaviorDimension, AssessmentDimension>;
  risk: RequestRisk;
}
/** 离线省略 elapsedMs 时不检查服务端时间；线上求解始终传入真实已用时间。 */
export function assessChallengeBehavior(input: { angle: number; pointer?: Pointer; trajectory?: Point[] | null; keyboard?: KeyboardBehavior | null; hints?: Hints | null; formBehavior?: FormBehavior | null }, options?: RequestAssessmentOptions & { elapsedMs?: number }): BehaviorAssessment;
export type AgentSource = 'fastpass' | 'compat-event' | 'canary-token' | 'fallback-api';
/** 每轮诱饵票据及假令牌；token 不能通过业务核验。 */
export interface AgentLures { ticket: string; token: string; expiresInMs: number }
export interface Pow { prefix: string; bits: number; expiresInMs: number; agent?: AgentLures }
export interface TokenResult { token: string; expiresInMs: number; usableAfterMs: number; agent?: AgentLures }
export interface Challenge { id: string; image: string; expiresInMs: number; agent?: AgentLures }
export type StateChange<T, R> = { value: T; ttlMs: number; result?: R } | { value?: undefined; ttlMs?: number; result?: R };
/** update 必须保证同一 key 的原子读改写；传给 updater 的对象须隔离，过期视为 undefined。
 * updater 为同步纯函数，返回 undefined value 表示删除。ttlMs 从提交时刻起算。
 * 所有服务副本必须共享原子状态与相同 namespace。close 仅由拥有者调用。
 */
export interface CaptchaStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  update<T, R>(key: string, updater: (current: T | undefined) => StateChange<T, R>): Promise<R | undefined>;
  close?(): Promise<void>;
}
export interface CaptchaOptions {
  enabled?: boolean; mode?: Mode; powBits?: number; tolerance?: number;
  minSolveMs?: number; minTokenAgeMs?: number; tokenTtlMs?: number; challengeTtlMs?: number; powTtlMs?: number;
  maxChallengesPerIp?: number; challengeTries?: number; rateLimit?: number; rateWindowMs?: number;
  imagesDir?: string; store?: CaptchaStore; namespace?: string; now?: () => number;
  ipqs?: IpqsOptions;
  /** 默认 blackbox；仅传 ipqs 配置时自动选 ipqs，off 关闭信誉查询。 */
  reputationProvider?: 'blackbox' | 'ipqs' | 'off';
  blackbox?: BlackboxOptions;
}
export interface CaptchaInstance {
  /** 仅供服务端查询；与验证流程共享缓存、限流和真实 IP 规范化。 */
  checkIpReputation(context: Context): Promise<IpReputation>;
  createPow(context: Context & RequestMetadata & { hints?: Hints | null }): Promise<Pow>;
  /** 命中诱饵时标记该轮次并以 BOT_DETECTED 拒绝；重复上报不重复计罚。 */
  reportAgent(input: Context & { ticket: string; source: AgentSource; token?: string }): Promise<never>;
  verifyBehavior(input: Context & RequestMetadata & AgentSignal & { pow?: { prefix: string; nonce: string }; trajectory?: Point[] | null; formBehavior?: FormBehavior | null; hints?: Hints | null }): Promise<TokenResult | { challenge: Challenge }>;
  /** 指针操作需本轮轨迹；键盘操作还需可重放到提交角度的 keyboard 记录。 */
  solveChallenge(input: Context & RequestMetadata & AgentSignal & { id: string; angle: number; pointer?: Pointer; trajectory?: Point[] | null; keyboard?: KeyboardBehavior | null; hints?: Hints | null }): Promise<TokenResult>;
  cancelChallenge(input: Context & { id: string }): Promise<boolean>;
  consumeToken(input: Context & { token: string }): Promise<boolean>;
  setMode(mode: Mode): void;
  close(): Promise<void>;
}
export class CaptchaError extends Error { code: string; status: number; details: Record<string, unknown>; constructor(code: string, message: string, status?: number, details?: Record<string, unknown>) }
export function createCaptcha(options?: CaptchaOptions): CaptchaInstance;
export function createMemoryStore(options?: { now?: () => number; maxEntries?: number; cleanupIntervalMs?: number }): CaptchaStore;
export function angleDiff(a: number, b: number): number;
export function validateContext(context: Context): Required<Context>;
