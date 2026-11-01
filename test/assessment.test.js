import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessChallengeBehavior } from '../src/index.js';
import { behaviorScenarios } from './fixtures/behavior-scenarios.js';
import { fixture, ctx, verify, keyboardForAngle } from './helpers.js';

test('多维评测矩阵覆盖兼容性、异常和已知可伪造场景', async t => {
  for (const scenario of behaviorScenarios) await t.test(scenario.name, () => {
    const result = assessChallengeBehavior(scenario.input, { elapsedMs: scenario.elapsedMs, ...scenario.assessmentOptions });
    assert.equal(result.passed, scenario.expectedPass, JSON.stringify(result));
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result, '报告只能含有限数值');
    assert.equal(Object.keys(result.dimensions).length, 13);
    assert.equal(result.reasons.length === 0, result.passed);
    if (scenario.expectedRisk) assert.equal(result.risk.level, scenario.expectedRisk);
  });
});

test('独立维度展示末端减速、修正、停顿、节律、环境和表单统计', () => {
  const resultFor = id => assessChallengeBehavior(behaviorScenarios.find(s => s.id === id).input, { elapsedMs: 3000 });
  assert.ok(resultFor('mouse').dimensions.dynamics.metrics.endSlowdown > 1);
  assert.equal(resultFor('correction').dimensions.motion.metrics.directionChanges, 1);
  assert.equal(resultFor('pause').dimensions.rhythm.metrics.pauses, 1);
  assert.equal(resultFor('periodic').dimensions.rhythm.metrics.repeatedPattern, 2);
  assert.equal(resultFor('keyboard').dimensions.keyboard.metrics.corrections, 1);
  assert.equal(resultFor('environment').dimensions.environment.metrics.pointerConsistent, false);
  assert.equal(resultFor('autofill').dimensions.form.metrics.inputs, 1);
  assert.equal(resultFor('mouse').dimensions.environment.status, 'unavailable');
  assert.equal(resultFor('jitter-speed').dimensions.dynamics.status, 'fail');
});

test('评测对非法输入稳健，离线缺少服务端时间标明未检查', () => {
  for (const input of [null, [], false, {}, { angle: 0, pointer: 'script' }]) assert.equal(assessChallengeBehavior(input).passed, false);
  for (const elapsedMs of [-1, Infinity, NaN]) assert.throws(() => assessChallengeBehavior({ angle: 0 }, { elapsedMs }), TypeError);
  const scenario = behaviorScenarios.find(s => s.id === 'mouse');
  const result = assessChallengeBehavior(scenario.input);
  assert.equal(result.dimensions.timing.status, 'info');
  assert.equal(result.dimensions.timing.metrics.serverTimeChecked, false);
  const tiny = [{ x: 0, y: 0, t: 0 }, { x: 1, y: 0, t: Number.MIN_VALUE }, { x: 2, y: 0, t: 100 }];
  const bounded = assessChallengeBehavior({ angle: 0, trajectory: tiny });
  assert.deepEqual(JSON.parse(JSON.stringify(bounded)), bounded);
  const extreme = assessChallengeBehavior({ angle: 0,
    trajectory: [0, 100, 200, 100, 0, 1e-310].map((x, i) => ({ x, y: 0, t: i * 20 })),
    formBehavior: { totalMs: 1000, focusOrder: ['field0'], fields: { field0: { n: 2, meanGap: Number.MIN_VALUE, varGap: 1 } } },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(extreme)), extreme, '极端有限输入的派生比值也能序列化');
});

test('服务端实际采用新增维度，拒绝抖动采样恒速与键盘混合绕过且扣减次数', async t => {
  for (const id of ['jitter-speed', 'mixed-bypass']) {
    const f = fixture(); t.after(() => f.close());
    const { challenge } = await verify(f.captcha);
    const scenario = behaviorScenarios.find(s => s.id === id);
    f.advance(3000);
    const angle = -f.answer(challenge.id);
    // 将重放调整为正确答案，保证失败由行为维度而不是图片答案导致。
    const keyboard = keyboardForAngle(angle);
    await assert.rejects(f.captcha.solveChallenge({ ...ctx, ...scenario.input, id: challenge.id, angle, keyboard }), error => {
      assert.equal(error.code, 'BEHAVIOR_REJECTED'); assert.equal(error.details.triesRemaining, 2);
      assert.equal(error.details.dimensions, undefined, '公开错误不泄露详细评测'); return true;
    });
    const natural = behaviorScenarios.find(s => s.id === 'mouse').input.trajectory;
    assert.ok((await f.captcha.solveChallenge({ ...ctx, id: challenge.id, angle, trajectory: natural })).token);
  }
});

test('自然轨迹在平移、屏幕缩放、较慢操作及服务端时钟容差下保持兼容', () => {
  const natural = behaviorScenarios.find(s => s.id === 'mouse').input.trajectory;
  for (const scale of [.25, 1, 4]) for (const timeScale of [1, 2, 10]) {
    const trajectory = natural.map(p => ({ x: p.x * scale - 1000, y: p.y * scale + 700, t: p.t * timeScale }));
    assert.equal(assessChallengeBehavior({ angle: 9, trajectory }, { elapsedMs: 3000 }).passed, true);
  }
  assert.equal(assessChallengeBehavior({ angle: 9, trajectory: natural }, { elapsedMs: 0 }).passed, true, '保留原有 250ms 容差');
  const future = natural.map(p => ({ ...p, t: p.t * 2 }));
  assert.equal(assessChallengeBehavior({ angle: 9, trajectory: future }, { elapsedMs: 0 }).passed, false);
});

test('键盘跨越 0° 与 Home 定位不误记为方向修正', () => {
  const keys = ['End', 'ArrowRight', 'ArrowRight', 'Home', 'ArrowRight', 'Enter'];
  const keyboard = { startAngle: 0, events: keys.map((key, i) => ({ key, control: 'stage', t: 100 + i * 50 })) };
  const result = assessChallengeBehavior({ angle: 15, pointer: 'keyboard', keyboard }, { elapsedMs: 1000 });
  assert.equal(result.passed, true); assert.equal(result.dimensions.keyboard.metrics.corrections, 0);
});
