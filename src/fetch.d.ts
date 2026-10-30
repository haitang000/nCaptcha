import type { CaptchaInstance } from './index.js';
export interface FetchOptions {
  basePath?: string; assetPath?: string; allowedOrigins?: string[]; secret?: string;
  getIp(request: Request): string;
  serveAsset?: (name: string, request: Request) => Response | Promise<Response>;
  onError?: ((error: unknown) => void) | null;
}
export function createFetchHandler(captcha: Pick<CaptchaInstance, 'createPow' | 'verifyBehavior' | 'solveChallenge' | 'cancelChallenge' | 'consumeToken'>, options: FetchOptions): (request: Request) => Promise<Response | null>;
export function readRequestJson(request: Request, maxBytes?: number): Promise<Record<string, unknown>>;
export function jsonResponse(status: number, data: unknown, headers?: Record<string, string>): Response;
export const clientAssets: Set<string>;
