// 从 localhosting 的行为评分实现提取。信号为客户端自报，只作为启发式证据。
export function analyzeTrajectory(points, isTouch) {
  if (!Array.isArray(points) || points.length < 5) return 0;

  const n = points.length;
  const totalTime = points[n - 1].t - points[0].t;
  if (totalTime < 200) return 0;

  // 逐段计算距离、耗时、路径总长
  let pathLen = 0;
  const segs = [];
  for (let i = 1; i < n; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const d = Math.hypot(dx, dy);
    const dt = points[i].t - points[i - 1].t;
    pathLen += d;
    segs.push({ dist: d, dt });
  }
  if (pathLen < 60) return 0;

  // 逐段间隔全部近乎相等 = 固定频率采样 = 脚本特征
  if (!isTouch) {
    const dts = segs.map((s) => s.dt).filter((d) => d > 0);
    if (dts.length >= 5) {
      const dm = dts.reduce((a, b) => a + b, 0) / dts.length;
      const spread = (Math.max(...dts) - Math.min(...dts)) / dm;
      if (spread < 0.01) return 0;
    }
  }

  // 弯曲度
  const dx0 = points[n - 1].x - points[0].x;
  const dy0 = points[n - 1].y - points[0].y;
  const directDist = Math.hypot(dx0, dy0);
  const straightness = pathLen / Math.max(directDist, 1);

  // 方向角方差
  let angleSum = 0, angleSumSq = 0, angleCount = 0;
  for (let i = 2; i < n; i++) {
    const x1 = points[i - 1].x - points[i - 2].x;
    const y1 = points[i - 1].y - points[i - 2].y;
    const x2 = points[i].x - points[i - 1].x;
    const y2 = points[i].y - points[i - 1].y;
    const d1 = Math.hypot(x1, y1);
    const d2 = Math.hypot(x2, y2);
    if (d1 < 2 || d2 < 2) continue;
    const dot = (x1 * x2 + y1 * y2) / (d1 * d2);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    angleSum += angle;
    angleSumSq += angle * angle;
    angleCount++;
  }
  if (angleCount < 3) return 0;
  const angleVar = angleSumSq / angleCount - (angleSum / angleCount) ** 2;

  // 速度波动度 = std(speeds) / mean(speeds)，人类 > 0.25
  let speedVar = 0;
  const speeds = segs.filter((s) => s.dt > 4).map((s) => s.dist / Math.max(s.dt, 1));
  if (speeds.length >= 3) {
    const sm = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    if (sm > 0.01) {
      speedVar = Math.sqrt(speeds.reduce((a, s) => a + (s - sm) ** 2, 0) / speeds.length) / sm;
    }
  }

  // 末尾减速：最后 20% 段落比前 80% 慢，说明靠近目标
  let decelerates = false;
  const mid = Math.max(1, Math.ceil(segs.length * 0.8));
  const early = segs.slice(0, mid).filter((s) => s.dt > 4);
  const late = segs.slice(mid).filter((s) => s.dt > 4);
  if (early.length >= 2 && late.length >= 1) {
    const earlySpd = early.reduce((a, s) => a + s.dist / Math.max(s.dt, 1), 0) / early.length;
    const lateSpd = late.reduce((a, s) => a + s.dist / Math.max(s.dt, 1), 0) / late.length;
    decelerates = earlySpd > 0.02 && lateSpd < earlySpd * 0.75;
  }

  let score = 0;
  if (straightness > 1.03) score += 1;
  if (angleVar > 0.008) score += 1;
  if (totalTime > 400) score += 1;
  if (totalTime > 800) score += 1;
  if (pathLen > 150) score += 1;
  if (speedVar > 0.25) score += 2;
  if (decelerates) score += 1;

  return score;
}

/**
 * 表单填写行为分析：打字节拍、焦点切换规律。
 *
 * 评分维度：
 *   - 总填写耗时
 *   - 焦点切换次数
 *   - 逐字段的按键间隔均值和方差（自然打字 vs 自动填充）
 *   - 多字段独立输入
 *
 * 满分 7 分。通过线同样由 createTurnstile 随机浮动。
 */
export function analyzeFormBehavior(data) {
  if (!data || typeof data.totalMs !== 'number') return 0;
  if (data.totalMs < 800) return 0;

  const fields = Object.values(data.fields ?? {});
  const totalKeystrokes = fields.reduce((s, f) => s + (f.n || 0), 0);
  if (totalKeystrokes < 3) return 0;
  // 我们的表单最多两三个输入框，报出 8 个以上焦点切换只能是脚本编的
  if (data.focusOrder?.length > 8) return 0;

  let score = 0;
  if (data.totalMs > 3000) score += 1;
  if (data.focusOrder?.length >= 1) score += 1;

  let typedFields = 0;
  for (const f of fields) {
    if (f.n < 2) continue;
    typedFields++;
    if (f.meanGap >= 25 && f.meanGap <= 600) score += 1;
    if (f.varGap > 80) score += 1;
  }
  if (typedFields >= 2) score += 1;

  return score;
}

/* ---- 客户端自报信号的合理性校验（软门槛的硬底线） ---- */

/** hints 缺失 = 中性（老页面）；给了但数值自相矛盾 = 判机器。 */
function plausibleHints(h) {
  if (h == null) return true;
  if (typeof h !== 'object' || Array.isArray(h)) return false;
  if (!Number.isFinite(h.dpr) || h.dpr < 0.5 || h.dpr > 4) return false;
  if (!Number.isFinite(h.sw) || !Number.isFinite(h.sh)) return false;
  if (h.sw < 200 || h.sw > 10000 || h.sh < 100 || h.sh > 10000) return false;
  if (!Number.isFinite(h.tz) || h.tz < -14 * 60 || h.tz > 14 * 60) return false;
  if (!Array.isArray(h.lang) || h.lang.length < 1 || h.lang.length > 8) return false;
  for (const l of h.lang) {
    if (typeof l !== 'string' || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l)) return false;
  }
  return true;
}

/** 轨迹必须落在屏幕范围内（多留 2000px 余量给滚动弹跳），时间严格递增。 */
function plausibleTrajectory(points, hints) {
  if (!Array.isArray(points) || points.length < 2 || points.length > 150) return false;
  let prevT = -1;
  for (const p of points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.t)) return false;
    if (Math.abs(p.x) > 100000 || Math.abs(p.y) > 100000 || p.t < 0 || p.t > 86400000) return false;
    if (p.t <= prevT) return false;
    prevT = p.t;
    if (hints && hints.sw > 0 && hints.sh > 0) {
      const slack = 2000;
      if (p.x < -slack || p.y < -slack || p.x > hints.sw + slack || p.y > hints.sh + slack) return false;
    }
  }
  return true;
}

export function validSignals(trajectory, form, hints) {
  if (!plausibleHints(hints) || (trajectory != null && !plausibleTrajectory(trajectory, hints))) return false;
  if (form == null) return true;
  if (typeof form !== 'object' || Array.isArray(form) || !Number.isFinite(form.totalMs) || form.totalMs < 0 || form.totalMs > 86400000) return false;
  if (!form.fields || typeof form.fields !== 'object' || Array.isArray(form.fields) || Object.keys(form.fields).length > 32) return false;
  if (!Array.isArray(form.focusOrder) || form.focusOrder.length > 32 || form.focusOrder.some(v => typeof v !== 'string' || v.length > 128)) return false;
  return Object.entries(form.fields).every(([name, f]) => name.length <= 128 && f &&
    Number.isInteger(f.n) && f.n >= 0 && f.n <= 100000 &&
    Number.isFinite(f.meanGap) && f.meanGap >= 0 && f.meanGap <= 86400000 &&
    Number.isFinite(f.varGap) && f.varGap >= 0 && f.varGap <= 86400000 ** 2);
}
