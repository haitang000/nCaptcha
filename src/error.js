export class CaptchaError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = 'CaptchaError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
export function invalid(message = '验证数据格式不正确') {
  return new CaptchaError('INVALID_INPUT', message);
}
