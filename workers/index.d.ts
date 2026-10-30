import { DurableObject } from 'cloudflare:workers';
export interface WorkerEnv {
  CAPTCHA_STATE: DurableObjectNamespace<CaptchaDurableObject>;
  ASSETS: Fetcher;
  CAPTCHA_SECRET: string;
  CAPTCHA_ALLOWED_ORIGINS?: string;
  CAPTCHA_MODE?: 'normal' | 'strict';
  CAPTCHA_ENABLED?: 'true' | 'false';
  CAPTCHA_BASE_PATH?: string; CAPTCHA_ASSET_PATH?: string;
  CAPTCHA_POW_BITS?: string; CAPTCHA_TOLERANCE?: string;
  CAPTCHA_MIN_SOLVE_MS?: string; CAPTCHA_MIN_TOKEN_AGE_MS?: string;
  CAPTCHA_TOKEN_TTL_MS?: string; CAPTCHA_CHALLENGE_TTL_MS?: string; CAPTCHA_POW_TTL_MS?: string;
  CAPTCHA_MAX_CHALLENGES_PER_IP?: string; CAPTCHA_CHALLENGE_TRIES?: string;
  CAPTCHA_RATE_LIMIT?: string; CAPTCHA_RATE_WINDOW_MS?: string;
}
export class CaptchaDurableObject extends DurableObject<WorkerEnv> {
  execute(operation: string, input: Record<string, unknown>): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string; status: number; details: Record<string, unknown> } }>;
  alarm(): Promise<void>;
}
export function createWorkerHandler(): { fetch(request: Request, env: WorkerEnv): Promise<Response> };
declare const worker: ReturnType<typeof createWorkerHandler>;
export default worker;
