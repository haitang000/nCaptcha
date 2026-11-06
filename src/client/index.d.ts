export type CaptchaState = 'idle' | 'loading' | 'verified' | 'error' | 'destroyed';
export interface WidgetOptions {
  apiUrl?: string; assetBaseUrl?: string; workerUrl?: string; action?: string;
  /** 后端签发的凭据；函数每次 reset 后重新调用，应从业务同源接口获取。 */
  intent?: string | ((signal: AbortSignal) => string | Promise<string>);
  form?: string | HTMLFormElement; prewarm?: boolean; fetch?: typeof globalThis.fetch;
  /** 每次 API 请求及响应体读取的超时，默认 15000ms；须为正整数，最大 2147483647。 */
  requestTimeoutMs?: number;
  onSuccess?: (token: string) => void; onExpire?: () => void;
  onError?: (error: Error) => void; onStateChange?: (state: CaptchaState) => void;
}
export interface Widget {
  /** 用户取消返回 null；reset/destroy 使进行中的任务以 AbortError 拒绝。 */
  verify(): Promise<string | null>;
  getToken(): string | null;
  reset(): void;
  destroy(): void;
}
export class CaptchaClientError extends Error { code: string; status?: number; triesRemaining?: number; retryAfterMs?: number; bot?: boolean; source?: 'fastpass' | 'compat-event' | 'canary-token' | 'fallback-api'; constructor(message: string, code?: string, details?: Record<string, unknown>) }
export function render(container: string | HTMLElement, options?: WidgetOptions): Widget;
export const Captcha: { render: typeof render };
export default Captcha;
