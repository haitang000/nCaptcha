export function sampleTrajectory(points, limit = 100) {
  if (points.length < 5) return null;
  const n = Math.min(limit, points.length), start = points[0].t;
  return Array.from({ length: n }, (_, i) => {
    const p = points[Math.round(i * (points.length - 1) / (n - 1))];
    return { x: p.x, y: p.y, t: p.t - start };
  });
}

export function createTracking(anchor, form) {
  const listeners = new AbortController();
  const { signal } = listeners;
  const doc = anchor.ownerDocument, win = doc.defaultView;
  const coarse = win.matchMedia('(pointer: coarse)').matches;
  const trajectory = [], gestures = [];
  let current = null, pointer = coarse ? 'touch' : 'mouse';
  function push(points, event) {
    const t = performance.now();
    const p = event.touches?.[0] ?? event.changedTouches?.[0] ?? event;
    if (!p || !Number.isFinite(p.clientX) || (points.length && t <= points.at(-1).t)) return;
    points.push({ x: Math.round(p.clientX), y: Math.round(p.clientY), t });
    if (points.length > 500) points.splice(0, 250);
  }
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
