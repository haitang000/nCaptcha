export function sampleTrajectory(points, limit = 100, minPoints = 5) {
  if (points.length < minPoints) return null;
  const n = Math.min(limit, points.length), start = points[0].t;
  return Array.from({ length: n }, (_, i) => {
    const p = points[Math.round(i * (points.length - 1) / (n - 1))];
    return { x: p.x, y: p.y, t: p.t - start };
  });
}

function pushPoint(points, event) {
  const t = performance.now();
  const p = event.touches?.[0] ?? event.changedTouches?.[0] ?? event;
  if (!p || !Number.isFinite(p.clientX) || !Number.isFinite(p.clientY) || (points.length && t <= points.at(-1).t)) return;
  points.push({ x: Math.round(p.clientX), y: Math.round(p.clientY), t });
  if (points.length > 500) points.splice(0, 250);
}

// 每轮图片挑战单独采集；捕获阶段记录松手，确保 change/submit 前已有完整轨迹。
export function createChallengeTracking(element) {
  const listeners = new AbortController(), points = [];
  const initialPointer = element.ownerDocument.defaultView.matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';
  let pointer = initialPointer, keyboard = null, startedAt = performance.now();
  const record = event => {
    if (event.type === 'pointerdown') keyboard = null;
    if (!keyboard) pointer = event.pointerType || initialPointer;
    pushPoint(points, event);
  };
  const listen = (type, fn) => element.addEventListener(type, fn, { capture: true, passive: true, signal: listeners.signal });
  for (const type of ['pointerdown', 'pointermove', 'pointerup']) listen(type, record);
  return {
    recordKey(key, control, angle) {
      pointer = 'keyboard';
      keyboard ??= { startAngle: Math.round(angle) % 360, events: [] };
      // 隐私模式下时钟可能被降精度；保留按键顺序，不丢弃同一时间格内的调整。
      const t = Math.max(performance.now() - startedAt, (keyboard.events.at(-1)?.t ?? -1) + .001);
      if (keyboard.events.length <= 512) keyboard.events.push({ key, control, t });
    },
    snapshot() { return { pointer, trajectory: sampleTrajectory(points, 100, 3), keyboard: keyboard ? { ...keyboard, events: keyboard.events.map(event => ({ ...event })) } : null }; },
    reset() { points.length = 0; pointer = initialPointer; keyboard = null; startedAt = performance.now(); },
    cleanup() { listeners.abort(); points.length = 0; keyboard = null; },
  };
}

export function createTracking(anchor, form) {
  const listeners = new AbortController();
  const { signal } = listeners;
  const doc = anchor.ownerDocument, win = doc.defaultView;
  const coarse = win.matchMedia('(pointer: coarse)').matches;
  const trajectory = [], gestures = [];
  let current = null, pointer = coarse ? 'touch' : 'mouse';
  const push = pushPoint;
  function start(e) { pointer = e.pointerType || 'touch'; if (pointer === 'touch' || pointer === 'pen') { current = []; push(current, e); } else push(trajectory, e); }
  function move(e) {
    if (e.pointerType) pointer = e.pointerType;
    if (pointer === 'touch' || pointer === 'pen') { if (current) push(current, e); }
    else push(trajectory, e);
  }
  function end(e) {
    if (current) { push(current, e); gestures.push(current); if (gestures.length > 8) gestures.shift(); current = null; }
  }
  const listen = (target, type, fn) => target.addEventListener(type, fn, { passive: true, signal });
  if ('PointerEvent' in win) {
    listen(doc, 'pointerdown', start); listen(doc, 'pointermove', move);
    listen(doc, 'pointerup', end); listen(doc, 'pointercancel', end);
  } else {
    listen(doc, 'touchstart', start); listen(doc, 'touchmove', move);
    listen(doc, 'touchend', end); listen(doc, 'touchcancel', end);
    listen(doc, 'mousemove', e => { pointer = 'mouse'; push(trajectory, e); });
  }
  const fields = new Map(), focusOrder = [], startedAt = performance.now();
  if (form) {
    for (const [i, input] of [...form.querySelectorAll('input, textarea')].slice(0, 32).entries()) {
      const name = `field${i}`;
      const init = () => { if (!fields.has(name)) { fields.set(name, { n: 0, last: 0, sum: 0, sumSq: 0 }); focusOrder.push(name); } return fields.get(name); };
      listen(input, 'focus', init);
      listen(input, 'input', () => {
        const field = init(), time = performance.now();
        if (field.n >= 100000) return;
        if (field.n) { const gap = time - field.last; field.sum += gap; field.sumSq += gap * gap; }
        field.n++; field.last = time;
      });
    }
  }
  return {
    getHints() {
      return { dpr: Math.max(.5, Math.min(4, win.devicePixelRatio || 1)), sw: win.screen.width, sh: win.screen.height,
        tz: new Date().getTimezoneOffset(), lang: [...(win.navigator.languages?.length ? win.navigator.languages : [win.navigator.language])].slice(0, 8), pointer, coarse };
    },
    getTrajectory() {
      if (coarse || pointer === 'touch' || pointer === 'pen') {
        const rect = anchor.getBoundingClientRect();
        for (const gesture of [...gestures].reverse()) {
          const end = gesture.at(-1);
          const length = gesture.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - gesture[i].x, p.y - gesture[i].y), 0);
          if (Math.hypot(end.x - rect.left - rect.width / 2, end.y - rect.top - rect.height / 2) <= 160 && length <= 320 && gesture.length >= 5) return sampleTrajectory(gesture);
        }
      }
      return sampleTrajectory(trajectory);
    },
    getFormBehavior() {
      const result = {};
      for (const [name, f] of fields) if (f.n >= 2) {
        const mean = f.sum / (f.n - 1);
        result[name] = { n: f.n, meanGap: Math.round(mean), varGap: Math.round(Math.max(0, f.sumSq / (f.n - 1) - mean ** 2)) };
      }
      return Object.values(result).reduce((n, f) => n + f.n, 0) >= 3 ? { fields: result, totalMs: Math.round(performance.now() - startedAt), focusOrder } : null;
    },
    cleanup() { listeners.abort(); trajectory.length = gestures.length = 0; fields.clear(); },
  };
}
