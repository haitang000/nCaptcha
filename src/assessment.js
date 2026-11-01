import { assessChallengeTrajectory, passesKeyboardBehavior, validSignals } from './signals.js';
import { keyboardAngle } from './client/keyboard.js';
import { assessRequestContext } from './request-assessment.js';

const dimension = (status = 'unavailable', metrics = {}) => ({ status, metrics });

/** 可离线重放的行为评测。结果不代表真人概率，也不能替代 PoW、图片答案或一次性令牌。 */
export function assessChallengeBehavior(input, { elapsedMs, requestHeaders, frequency, nowMs } = {}) {
  if (elapsedMs !== undefined && (!Number.isFinite(elapsedMs) || elapsedMs < 0)) throw new TypeError('elapsedMs 必须为非负有限数');
  const dimensions = Object.fromEntries(['integrity', 'timing', 'motion', 'dynamics', 'rhythm', 'keyboard', 'environment', 'form', 'browser', 'timezone', 'headers', 'frequency', 'language'].map(name => [name, dimension()]));
  let risk = { score: 0, level: 'unknown', signals: [], powBits: 0 };
  const reasons = [];
  const result = () => ({ passed: !reasons.length, reasons, dimensions, risk });
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    dimensions.integrity = dimension('fail'); reasons.push('SIGNALS_INVALID'); return result();
  }
  const { angle, pointer = 'mouse', trajectory = null, keyboard = null, hints = null, formBehavior = null } = input;
  if (!Number.isFinite(angle) || Math.abs(angle) > 360000 || !['mouse', 'touch', 'pen', 'keyboard'].includes(pointer) || !validSignals(trajectory, formBehavior, hints)) {
    dimensions.integrity = dimension('fail'); reasons.push('SIGNALS_INVALID'); return result();
  }
  dimensions.integrity = dimension('pass');
  const request = assessRequestContext(hints, { requestHeaders, frequency, nowMs, pointer });
  Object.assign(dimensions, request.dimensions);
  risk = request.risk;
  let pointerPasses = false;
  if (trajectory) {
    const motion = assessChallengeTrajectory(trajectory), m = motion.metrics;
    const timingReasons = [];
    if (trajectory[0].t !== 0) timingReasons.push('TRAJECTORY_TIME_ORIGIN');
    if (elapsedMs !== undefined && trajectory.at(-1).t > elapsedMs + 250) timingReasons.push('TRAJECTORY_FUTURE');
    dimensions.timing = dimension(timingReasons.length ? 'fail' : elapsedMs === undefined ? 'info' : 'pass', { durationMs: m.durationMs, serverTimeChecked: elapsedMs !== undefined });
    const dynamicsReasons = motion.reasons.filter(reason => ['TRAJECTORY_MECHANICAL', 'TRAJECTORY_CONSTANT_SPEED'].includes(reason));
    const motionReasons = motion.reasons.filter(reason => !dynamicsReasons.includes(reason));
    dimensions.motion = dimension(motionReasons.length ? 'fail' : 'pass', {
      points: m.points, movingSegments: m.movingSegments, pathLength: m.pathLength, directDistance: m.directDistance,
      straightness: m.straightness, directionChanges: m.directionChanges,
    });
    dimensions.dynamics = dimension(dynamicsReasons.length ? 'fail' : 'pass', {
      meanSpeed: m.meanSpeed, speedCv: m.speedCv, meanAcceleration: m.meanAcceleration, accelerationCv: m.accelerationCv, endSlowdown: m.endSlowdown,
    });
    dimensions.rhythm = dimension('info', { intervalCv: m.intervalCv, pauses: m.pauses, repeatedPattern: m.repeatedPattern });
    reasons.push(...timingReasons, ...motion.reasons);
    pointerPasses = !timingReasons.length && motion.passed;
  } else if (pointer !== 'keyboard') {
    dimensions.motion = dimension('fail'); reasons.push('TRAJECTORY_MISSING');
  }

  if (pointer === 'keyboard') {
    // 混合输入中的任意指针记录也必须通过，不能用 startAngle:0 掩盖低质量指针轨迹。
    const passed = (!trajectory || pointerPasses) && passesKeyboardBehavior(keyboard, angle, elapsedMs ?? Infinity, pointerPasses);
    const metrics = {};
    if (passed) {
      let current = keyboard.startAngle, previousDirection = 0, corrections = 0;
      for (const event of keyboard.events) {
        const next = keyboardAngle(current, event.key, event.control);
        // 图片区域跨越 0° 时仍沿原方向旋转；Home/End 是定位，不算反向修正。
        const direction = next === current ? 0 : ['ArrowLeft', 'ArrowDown', 'PageDown'].includes(event.key) ? -1 : ['ArrowRight', 'ArrowUp', 'PageUp'].includes(event.key) ? 1 : 0;
        if (event.key === 'Home' || event.key === 'End') previousDirection = 0;
        if (direction && previousDirection && direction !== previousDirection) corrections++;
        if (direction) previousDirection = direction;
        current = next;
      }
      Object.assign(metrics, { events: keyboard.events.length, durationMs: keyboard.events.at(-1).t, corrections, mixedInput: !!trajectory });
    } else reasons.push('KEYBOARD_REPLAY_INVALID');
    dimensions.keyboard = dimension(passed ? 'pass' : 'fail', metrics);
    if (!trajectory && passed) dimensions.timing = dimension(elapsedMs === undefined ? 'info' : 'pass', {
      durationMs: keyboard.events.at(-1).t, serverTimeChecked: elapsedMs !== undefined,
    });
  }
  if (hints) dimensions.environment = dimension('info', {
    pointerConsistent: hints.pointer === undefined || hints.pointer === pointer,
    languages: hints.lang.length, ...(hints.coarse === undefined ? {} : { coarse: hints.coarse }),
  });
  if (formBehavior) {
    const fields = Object.values(formBehavior.fields), inputs = fields.reduce((sum, field) => sum + field.n, 0);
    const typed = fields.filter(field => field.n >= 2), gaps = typed.reduce((sum, field) => sum + field.n - 1, 0);
    const meanGap = gaps ? typed.reduce((sum, field) => sum + field.meanGap * (field.n - 1), 0) / gaps : 0;
    const variance = gaps ? typed.reduce((sum, field) => sum + (field.varGap + (field.meanGap - meanGap) ** 2) * (field.n - 1), 0) / gaps : 0;
    dimensions.form = dimension('info', { durationMs: formBehavior.totalMs, fields: fields.length, inputs,
      focusChanges: Math.max(0, formBehavior.focusOrder.length - 1), meanGapMs: meanGap, cadenceCv: meanGap ? Math.min(Number.MAX_VALUE, Math.sqrt(variance) / meanGap) : 0 });
  }
  return result();
}
