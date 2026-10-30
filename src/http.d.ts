import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CaptchaInstance } from './index.js';
export interface HttpOptions {
  basePath?: string; assetPath?: string; secret?: string;
  allowedOrigins?: string[]; trustedProxies?: string[]; onError?: ((error: unknown) => void) | null;
}
export function getClientIp(req: IncomingMessage, trustedProxies?: string[]): string;
export function readJson(req: IncomingMessage & { body?: unknown }, maxBytes?: number): Promise<Record<string, unknown>>;
export function sendJson(res: ServerResponse, status: number, body: unknown): void;
/** 返回 false 表示请求不属于此处理器，由宿主处理剩余路由。 */
export function createHttpHandler(captcha: CaptchaInstance, options?: HttpOptions): (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
export function createExpressMiddleware(captcha: CaptchaInstance, options?: HttpOptions): (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => void;
