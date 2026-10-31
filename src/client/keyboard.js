const keys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Enter']);

export function isRotationKey(key) { return keys.has(key); }

// 客户端与服务端使用同一组键盘步长，避免浏览器原生 PageUp/Down 行为差异。
export function keyboardAngle(angle, key, control) {
  if (key === 'Home') return 0;
  if (key === 'End') return 359;
  const step = control === 'stage' ? 15 : 1;
  const delta = ['ArrowLeft', 'ArrowDown'].includes(key) ? -step : ['ArrowRight', 'ArrowUp'].includes(key) ? step : key === 'PageUp' ? 10 * step : key === 'PageDown' ? -10 * step : 0;
  const next = angle + delta;
  return control === 'stage' ? ((next % 360) + 360) % 360 : Math.max(0, Math.min(359, next));
}
