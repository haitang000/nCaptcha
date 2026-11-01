// 合成回归样本，不是实测真人数据。预期通过与真人/脚本标签分开，显式保留已知可伪造样本。
const natural = [
  { x: 100, y: 200, t: 0 }, { x: 105, y: 200, t: 15 }, { x: 125, y: 201, t: 43 },
  { x: 165, y: 200, t: 70 }, { x: 200, y: 201, t: 105 }, { x: 215, y: 200, t: 150 }, { x: 218, y: 200, t: 210 },
];
const keyboard = { startAngle: 0, events: [
  { key: 'PageUp', control: 'range', t: 90 }, { key: 'ArrowLeft', control: 'range', t: 145 }, { key: 'Enter', control: 'range', t: 230 },
] };
const uniform = Array.from({ length: 13 }, (_, i) => ({ x: 100 + i * 10, y: 200, t: i * 40 }));
const jitterTimes = [0, 22, 68, 95, 155, 180, 224, 285, 310, 369, 400, 445, 495];
const jitterUniformSpeed = jitterTimes.map(t => ({ x: 100 + t * .5, y: 200, t }));
const periodic = [{ x: 0, y: 100, t: 0 }];
for (let i = 0; i < 16; i++) {
  const last = periodic.at(-1), even = i % 2 === 0;
  periodic.push({ x: last.x + (even ? 5 : 15), y: 100, t: last.t + (even ? 20 : 40) });
}
const scenario = (id, name, group, label, expectedPass, input, extra = {}) => ({ id, name, group, label, expectedPass, input: { angle: 9, ...input }, elapsedMs: 3000, ...extra });
const hints = { dpr: 2, sw: 1920, sh: 1080, vw: 1200, vh: 800, tz: 0, timeZone: 'UTC', lang: ['zh-CN'] };
const requestHeaders = { 'user-agent': 'Mozilla/5.0', 'accept-language': 'zh-CN', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' };
export const behaviorScenarios = [
  scenario('mouse', '鼠标自然加减速', '输入兼容', 'human-like', true, { trajectory: natural }),
  scenario('touch', '触屏拖动', '输入兼容', 'human-like', true, { pointer: 'touch', trajectory: natural }),
  scenario('pen', '触控笔拖动', '输入兼容', 'human-like', true, { pointer: 'pen', trajectory: natural }),
  scenario('short', '2px 短距离微调', '输入兼容', 'human-like', true, { trajectory: [{ x: 0, y: 0, t: 0 }, { x: 1, y: 0, t: 45 }, { x: 2, y: 0, t: 130 }] }),
  scenario('fixed-refresh', '固定刷新率且速度变化', '输入兼容', 'human-like', true, { trajectory: natural.map((p, i) => ({ ...p, t: i * 30 })) }),
  scenario('correction', '越过目标后回调', '操作策略', 'human-like', true, { trajectory: [...natural, { x: 210, y: 200, t: 290 }, { x: 208, y: 200, t: 360 }] }),
  scenario('pause', '停顿后继续操作', '操作策略', 'human-like', true, { trajectory: [...natural, { x: 218, y: 200, t: 700 }, { x: 220, y: 200, t: 790 }] }),
  scenario('keyboard', '纯键盘方向修正', '无障碍', 'human-like', true, { pointer: 'keyboard', keyboard }),
  scenario('mixed', '指针与键盘混合输入', '无障碍', 'human-like', true, { pointer: 'keyboard', trajectory: natural, keyboard }),
  scenario('autofill', '自动填充和缺失设备提示', '环境与表单', 'human-like', true, { trajectory: natural, formBehavior: { totalMs: 50, fields: { field0: { n: 1, meanGap: 0, varGap: 0 } }, focusOrder: ['field0'] } }),
  scenario('environment', '设备提示与实际输入不同', '环境与表单', 'human-like', true, { trajectory: natural, hints: { dpr: 2, sw: 1024, sh: 768, tz: -480, lang: ['zh-CN'], pointer: 'touch', coarse: true } }),
  scenario('context-normal', '视口、时区和请求头一致', '请求环境', 'human-like', true, { trajectory: natural, hints },
    { assessmentOptions: { requestHeaders }, expectedRisk: 'low' }),
  scenario('context-language', '语言偏好差异保留完整验证', '请求环境', 'human-like', true, { trajectory: natural, hints },
    { assessmentOptions: { requestHeaders: { ...requestHeaders, 'accept-language': 'de' } }, expectedRisk: 'low' }),
  scenario('context-timezone', '时区名称与时差不一致', '请求环境', 'scripted', true, { trajectory: natural, hints: { ...hints, tz: 480 } },
    { assessmentOptions: { requestHeaders }, expectedRisk: 'low', limitation: '单项时区差异仅记录风险，不单独拒绝验证。' }),
  scenario('context-combined', '自动化请求头叠加时区差异', '请求环境', 'scripted', true, { trajectory: natural, hints: { ...hints, tz: 480 } },
    { assessmentOptions: { requestHeaders: { 'user-agent': 'curl/8', 'accept-language': 'de' } }, expectedRisk: 'high', limitation: '环境风险提高签发 PoW 的计算难度，不代替图片和行为检查。' }),
  scenario('context-burst', '短时突发叠加高窗口利用率', '请求环境', 'scripted', true, { trajectory: natural, hints },
    { assessmentOptions: { requestHeaders, frequency: { count: 55, burstCount: 20, limit: 60, windowMs: 600000, burstWindowMs: 10000 } }, expectedRisk: 'high', limitation: '频率快照由服务端原子限流提供，超过配额仍返回 429。' }),
  scenario('no-motion', '缺失轨迹', '结构与时间', 'scripted', false, {}),
  scenario('stationary', '静止点冒充操作', '结构与时间', 'scripted', false, { trajectory: natural.map(p => ({ ...p, x: 100, y: 200 })) }),
  scenario('too-fast', '过短操作', '结构与时间', 'scripted', false, { trajectory: natural.map(p => ({ ...p, t: p.t / 10 })) }),
  scenario('future', '伪造未来时间', '结构与时间', 'scripted', false, { trajectory: natural.map(p => ({ ...p, t: p.t * 100 })) }),
  scenario('bad-origin', '伪造时间基点', '结构与时间', 'scripted', false, { trajectory: natural.map(p => ({ ...p, t: p.t + 1 })) }),
  scenario('time-order', '时间倒序', '结构与时间', 'scripted', false, { trajectory: [...natural].reverse() }),
  scenario('nonfinite', '非有限坐标', '结构与时间', 'scripted', false, { trajectory: natural.map(p => ({ ...p, x: Infinity })) }),
  scenario('uniform', '固定采样匀速', '运动合成', 'scripted', false, { trajectory: uniform }),
  scenario('jitter-speed', '随机采样掩盖严格恒速', '运动合成', 'scripted', false, { trajectory: jitterUniformSpeed }),
  scenario('fake-keyboard', '只改报键盘标记', '键盘重放', 'scripted', false, { pointer: 'keyboard' }),
  scenario('wrong-keyboard', '键盘重放角度不符', '键盘重放', 'scripted', false, { pointer: 'keyboard', angle: 10, keyboard }),
  scenario('mixed-bypass', '键盘零起点掩盖机械指针', '键盘重放', 'scripted', false, { pointer: 'keyboard', trajectory: uniform, keyboard }),
  scenario('future-keyboard', '键盘事件发生于未来', '键盘重放', 'scripted', false, { pointer: 'keyboard', keyboard: { ...keyboard, events: keyboard.events.map(event => ({ ...event, t: event.t * 100 })) } }),
  scenario('periodic', '重复节律（仅观察）', '已知局限', 'scripted', true, { trajectory: periodic }, { limitation: '节律重复不足以单独判定机器，仍要求图片答案与 PoW。' }),
  scenario('replay-natural', '脚本重放自然轨迹', '已知局限', 'scripted', true, { trajectory: natural }, { limitation: '客户端可伪造自然轨迹，行为检查不具备身份认证能力。' }),
];
