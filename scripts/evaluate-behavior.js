import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessChallengeBehavior } from '../src/index.js';
import { behaviorScenarios } from '../test/fixtures/behavior-scenarios.js';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output-dir' || !args[1])) throw new Error('用法：npm run test:assessment -- [--output-dir <目录>]');
const root = fileURLToPath(new URL('../', import.meta.url));
const outputDir = path.resolve(root, args[1] ?? 'test-results/assessment');
const samples = 100;
const results = behaviorScenarios.map(({ input, ...scenario }) => {
  const assess = () => assessChallengeBehavior(input, { elapsedMs: scenario.elapsedMs });
  for (let i = 0; i < 20; i++) assess();
  const durations = Array.from({ length: samples }, () => { const start = performance.now(); assess(); return performance.now() - start; }).sort((a, b) => a - b);
  const assessment = assess();
  return { ...scenario, assessment, matchesExpectation: assessment.passed === scenario.expectedPass,
    latencyMs: { p50: durations[Math.ceil(samples * .5) - 1], p95: durations[Math.ceil(samples * .95) - 1] } };
});
const summarize = rows => ({ samples: rows.length, accepted: rows.filter(row => row.assessment.passed).length,
  rejected: rows.filter(row => !row.assessment.passed).length, regressions: rows.filter(row => !row.matchesExpectation).length });
const dimensions = Object.fromEntries(Object.keys(results[0].assessment.dimensions).map(name => [name,
  Object.fromEntries(['pass', 'fail', 'info', 'unavailable'].map(status => [status, results.filter(row => row.assessment.dimensions[name].status === status).length]))]));
const report = {
  schemaVersion: 1, generatedAt: new Date().toISOString(),
  scope: '合成样本的行为检查回归；不测量完整验证码攻破率，不代表真实用户误拒率或机器人检出率。',
  latencyScope: '本机纯行为评估函数耗时，每个样本预热 20 次后采样 100 次；不含 PoW、图片、网络和存储。',
  summary: summarize(results),
  cohorts: { humanLike: summarize(results.filter(row => row.label === 'human-like')), scripted: summarize(results.filter(row => row.label === 'scripted')) },
  groups: Object.fromEntries([...new Set(results.map(row => row.group))].map(group => [group, summarize(results.filter(row => row.group === group))])),
  dimensions, results,
};
const human = report.cohorts.humanLike, scripted = report.cohorts.scripted;
const lines = [
  '# 多维人机验证行为评测', '', report.scope, '',
  `共 ${report.summary.samples} 个场景，预期匹配 ${report.summary.samples - report.summary.regressions} 个，回归失败 ${report.summary.regressions} 个。`, '',
  `类真人合成样本：通过 ${human.accepted}/${human.samples}，拒绝 ${human.rejected}。脚本合成样本：拒绝 ${scripted.rejected}/${scripted.samples}，通过 ${scripted.accepted}。`, '',
  '## 维度覆盖', '', '| 维度 | 通过 | 失败 | 仅观察 | 无数据 |', '| --- | ---: | ---: | ---: | ---: |',
  ...Object.entries(dimensions).map(([name, counts]) => `| ${name} | ${counts.pass} | ${counts.fail} | ${counts.info} | ${counts.unavailable} |`), '',
  '## 场景结果', '', report.latencyScope, '',
  '| 场景 | 分组 | 预期 | 实际 | 匹配 | P95(ms) | 拒绝原因 |', '| --- | --- | --- | --- | --- | ---: | --- |',
  ...results.map(row => `| ${row.name} | ${row.group} | ${row.expectedPass ? '通过' : '拒绝'} | ${row.assessment.passed ? '通过' : '拒绝'} | ${row.matchesExpectation ? '是' : '否'} | ${row.latencyMs.p95.toFixed(4)} | ${row.assessment.reasons.join(', ') || '—'} |`), '',
  '## 已知局限', '',
  ...results.filter(row => row.limitation).map(row => `- ${row.name}：${row.limitation}`), '',
  '行为评估通过仍需满足服务端 PoW、图片答案、等待时间、限流和一次性令牌检查。环境差异、自动填充、停顿和重复节律仅作观察。', '',
];
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
await fs.writeFile(path.join(outputDir, 'report.md'), lines.join('\n'));
console.log(`多维评测：${report.summary.samples} 个场景，${report.summary.regressions} 个回归失败。`);
console.log(`类真人样本通过 ${human.accepted}/${human.samples}；脚本样本拒绝 ${scripted.rejected}/${scripted.samples}（包含已知可伪造样本）。`);
console.log(`报告：${path.join(outputDir, 'report.md')}\n详细数据：${path.join(outputDir, 'report.json')}`);
if (report.summary.regressions) process.exitCode = 1;
