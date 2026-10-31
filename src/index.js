import { fileURLToPath } from 'node:url';
import { createCaptchaCore } from './core.js';
import { loadPuzzles } from './images.js';
export { createMemoryStore, CaptchaError, angleDiff, validateContext } from './core.js';
export { assessChallengeBehavior } from './assessment.js';

export function createCaptcha(options = {}) {
  return createCaptchaCore(options, () => loadPuzzles(options.imagesDir ?? fileURLToPath(new URL('../assets/puzzles/', import.meta.url))));
}
