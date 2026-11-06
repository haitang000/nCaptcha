import { fileURLToPath } from 'node:url';
import { createCaptchaCore } from './core.js';
import { loadPuzzles, validatePrivatePuzzles } from './images.js';
export { createMemoryStore, CaptchaError, angleDiff, validateContext } from './core.js';
export { assessChallengeBehavior } from './assessment.js';
export { assessRequestContext } from './request-assessment.js';

export function createCaptcha(options = {}) {
  const bundled = fileURLToPath(new URL('../assets/puzzles/', import.meta.url));
  return createCaptchaCore(options, config => {
    if (config.requirePrivateImages && !options.imagesDir) throw new Error('私有题库模式必须设置 imagesDir / CAPTCHA_IMAGES_DIR');
    const pictures = loadPuzzles(options.imagesDir ?? bundled);
    if (config.requirePrivateImages) validatePrivatePuzzles(pictures, loadPuzzles(bundled), config.minPrivateImages);
    return pictures;
  });
}
