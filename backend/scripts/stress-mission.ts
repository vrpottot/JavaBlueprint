import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { JavaParserEngine } from '../src/adapters/java-engine.js';
import { DockerRunner } from '../src/adapters/docker-runner.js';
import { runProcess } from '../src/adapters/process.js';
import { graph } from '../src/services/graph.js';
import { analyze } from '../src/services/analyzer.js';
import type { EngineResult, SourceFile, Transform, Verification } from '../src/types/index.js';

// Manual stress check. Deliberately excluded from the short per-push CI suite.
const outIndex = process.argv.indexOf('--output');
const output = outIndex >= 0 ? resolve(process.argv[outIndex + 1]!) : await mkdtemp(join(tmpdir(), 'javascope-mission-'));
await mkdir(output, { recursive: true });
const files: SourceFile[] = await Promise.all(['MissionControl.java', 'MissionControlTest.java'].map(async path => ({
  path, content: await readFile(new URL(`../examples/mission-control/${path}`, import.meta.url), 'utf8'),
})));
const engine = new JavaParserEngine();
const runner = new DockerRunner();
const inputs = ['', '0 1', '1 1', '24 99', '120 7', '300 42', '-4 3', 'abc', '60 7 1', '24 99']
  .map((stdin, i) => ({ name: `${i}:${stdin || 'empty'}`, stdin }));
const selected = [inputs[0]!, inputs[1]!, inputs[3]!, inputs[5]!, inputs[8]!];
const report: Record<string, unknown> = {
  started: new Date().toISOString(),
  sources: files.map(file => ({ path: file.path, lines: file.content.split('\n').length - 1,
    nonblankLines: file.content.split('\n').filter(line => line.trim()).length,
    sha256: createHash('sha256').update(file.content).digest('hex') })),
};
const save = () => writeFile(join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');

function checkJava(result: Verification) {
  assert.equal(result.current.compilation.exitCode, 0, result.current.compilation.stderr);
  assert.ok(!result.current.compilation.timedOut);
  assert.ok(result.current.runs.every(run => run.exitCode === 0 && !run.timedOut && !run.outputLimitExceeded));
  assert.equal(result.current.tests.status, 'passed', result.current.tests.report);
  assert.match(result.current.tests.report ?? '', /16 tests successful/);
}

async function lint() {
  const docker = process.env.DOCKER_BIN || 'docker';
  const staging = await mkdtemp(join(tmpdir(), 'jbp-mission-lint-'));
  const name = `jbp-mission-lint-${randomUUID()}`;
  try {
    await chmod(staging, 0o755);
    for (const file of files) {
      await writeFile(join(staging, file.path), file.content, { mode: 0o644 });
      await chmod(join(staging, file.path), 0o644);
    }
    const result = await runProcess(docker, ['run', '--pull=never', '--name', name,
      '--network=none', '--read-only', '--user=10001:10001', '--cap-drop=ALL',
      '--security-opt=no-new-privileges', '--memory=256m', '--memory-swap=256m', '--cpus=1', '--pids-limit=96',
      '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777',
      '--mount', `type=bind,src=${staging},dst=/input,readonly`, process.env.RUNNER_IMAGE || 'javablueprint-runner:local',
      'javac', '-J-Xmx160m', '-J-XX:ActiveProcessorCount=1', '-Xlint:all', '-proc:none', '--release', '21',
      '-encoding', 'UTF-8', '-cp', '/opt/junit.jar', '-d', '/tmp', ...files.map(file => `/input/${file.path}`),
    ], { timeoutMs: 25000, outputBytes: 1024 * 1024 });
    report.lint = result;
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, '', 'javac -Xlint:all warnings');
  } finally {
    const removed = await runProcess(docker, ['rm', '-f', name], { timeoutMs: 5000 });
    await rm(staging, { recursive: true, force: true });
    assert.ok(removed.exitCode === 0 || /No such container/.test(removed.stderr), 'lint container cleanup failed');
  }
}

function summarize(ir: EngineResult) {
  const fileNodes = ir.nodes.filter(node => node.source.file === 'MissionControl.java');
  return {
    nodes: ir.nodes.length, edges: ir.edges.length, mainNodes: fileNodes.length,
    methods: fileNodes.filter(node => node.astKind === 'MethodDeclaration').length,
    constructors: fileNodes.filter(node => node.astKind === 'ConstructorDeclaration').length,
    compactConstructors: fileNodes.filter(node => node.astKind === 'CompactConstructorDeclaration').length,
    kinds: Object.fromEntries([...new Set(ir.nodes.map(node => node.astKind))].map(kind => [kind, ir.nodes.filter(node => node.astKind === kind).length])),
    warnings: ir.warnings,
  };
}

try {
  const begin = performance.now();
  const parsed = await engine.process(files);
  assert.deepEqual(parsed.errors, []);
  const parseMs = Math.round(performance.now() - begin);
  const graphBegin = performance.now();
  const layout = graph(parsed);
  report.parser = { ...summarize(parsed), parseMs, layoutMs: Math.round(performance.now() - graphBegin) };
  report.complexity = analyze(parsed).complexity.filter(cost => cost.file === 'MissionControl.java');
  assert.equal(parsed.nodes.filter(node => node.astKind === 'CompactConstructorDeclaration').length, 4);
  assert.ok(layout.edges.every(edge => layout.nodes.some(node => node.id === edge.source) && layout.nodes.some(node => node.id === edge.target)));
  console.log('Parser and graph:', report.parser);
  const baseline = await runner.verify(files, files, { mainClass: 'MissionControl', inputs, compare: false }, 0);
  report.baseline = baseline;
  await save();
  checkJava(baseline);
  assert.equal(baseline.current.runs[0]!.stdout, baseline.current.runs[7]!.stdout, 'invalid input fallback');
  assert.equal(baseline.current.runs[3]!.stdout, baseline.current.runs[9]!.stdout, 'deterministic repeated run');
  await lint();
  console.log('Baseline: 10 executions, 9 distinct inputs, 16 real JUnit tests, no javac lint warnings');
  const node = (predicate: (value: EngineResult['nodes'][number]) => boolean) => {
    const found = parsed.nodes.find(value => value.source.file === 'MissionControl.java' && predicate(value));
    assert.ok(found, 'required AST node not found');
    return found;
  };
  const variants: { name: string; same: boolean; operations: Transform[] }[] = [
    { name: 'indexed loop to foreach', same: true, operations: [{ type: 'replaceMethod', nodeId: node(n => n.title === 'linearEnergy').id,
      code: 'static long linearEnergy(int[] values) { long sum=0; for(int value:values) sum+=value; return sum; }' }] },
    { name: 'reorder compact-constructor validation', same: true, operations: [{ type: 'updateCondition', nodeId: node(n => n.snippet === 'size < 0 || size > MAX_MISSIONS').id,
      code: 'size > MAX_MISSIONS || size < 0' }] },
    { name: 'reject exact fuel balance mutation', same: false, operations: [{ type: 'updateCondition', nodeId: node(n => n.snippet === 'amount > available').id, code: 'amount >= available' }] },
    { name: 'payload fuel multiplier mutation', same: false, operations: [{ type: 'updateVariable', nodeId: node(n => n.code === 'long payload = mission.mass * 3L;').id, code: 'mission.mass * 4L' }] },
  ];
  const outcomes: unknown[] = [];
  report.variants = outcomes;
  for (const variant of variants) {
    const changed = await engine.process(files, parsed.identities, variant.operations);
    assert.deepEqual(changed.errors, []);
    const result = await runner.verify(files, changed.files, { mainClass: 'MissionControl', inputs: selected, compare: false }, 1);
    const differences = result.current.runs.filter(run => run.stdout !== baseline.current.runs.find(original => original.name === run.name)!.stdout).map(run => run.name);
    outcomes.push({ name: variant.name, preservesBehavior: variant.same, differences, verification: result });
    await save();
    assert.equal(result.current.compilation.exitCode, 0, result.current.compilation.stderr);
    if (variant.same) { checkJava(result); assert.deepEqual(differences, []); }
    else { assert.equal(result.current.tests.status, 'failed', 'mutation escaped tests'); }
    console.log(`${variant.name}: JUnit=${result.current.tests.status}, changed outputs=${differences.length}`);
  }
  const owner = parsed.containers!.find(container => container.name === 'MissionControl')!;
  const added = await engine.process(files, parsed.identities, [{ type: 'addMethod', nodeId: owner.id, code: 'static int auditMarker() { return 31; }' }]);
  const marker = added.nodes.find(n => n.title === 'auditMarker')!;
  const restored = await engine.process(added.files, added.identities, [{ type: 'deleteMethod', nodeId: marker.id }]);
  const roundTrip = await runner.verify(files, restored.files, { mainClass: 'MissionControl', inputs: selected, compare: false }, 2);
  report.roundTrip = roundTrip;
  await save();
  checkJava(roundTrip);
  assert.equal(restored.nodes.length, parsed.nodes.length);
  for (const run of roundTrip.current.runs) assert.equal(run.stdout, baseline.current.runs.find(original => original.name === run.name)!.stdout);
  report.finished = new Date().toISOString();
  await save();
  console.log(`Mission stress audit passed. Evidence: ${join(output, 'results.json')}`);
} catch (error) {
  report.failure = String(error);
  await save();
  throw error;
}
