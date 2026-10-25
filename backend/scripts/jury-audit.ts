import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { JavaParserEngine } from '../src/adapters/java-engine.js';
import { DockerRunner } from '../src/adapters/docker-runner.js';
import { runProcess } from '../src/adapters/process.js';
import { analyze } from '../src/services/analyzer.js';
import { graph } from '../src/services/graph.js';
import type { EngineResult, SourceFile, Transform, Verification } from '../src/types/index.js';

// Deliberately manual. This adversarial corpus does not run on every push.
const argument = (flag: string, fallback: string) => process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1]! : fallback;
const output = resolve(argument('--output', '/tmp/javascope-jury/results'));
const toolsDirectory = resolve(argument('--coverage-tools', '/tmp/javascope-jury/tools'));
const engine = new JavaParserEngine();
const runner = new DockerRunner();
const cases = [
  { name: 'ClearingHouse', folder: 'clearing', max: '180 17 1', safe: 'inversionCount', mutation: 'fee',
    mutate: (code: string) => code.replace('Math.min(500,', 'Math.min(499,'),
    safeChange: (code: string) => code.replace('return count;', 'return 0L + count;') },
  { name: 'QueryForge', folder: 'query', max: '220 17', safe: 'runningTotal', mutation: 'evaluate',
    mutate: (code: string) => code.replace('Math.multiplyExact(a.asLong(), b.asLong())', 'Math.addExact(a.asLong(), b.asLong())'),
    safeChange: (code: string) => code.replace('return result;', 'return (result);') },
  { name: 'TransitGrid', folder: 'transit', max: '48 17 1', safe: 'peak', mutation: 'fare',
    mutate: (code: string) => code.replace('100 + 25L', '101 + 25L'),
    safeChange: (code: string) => code.replace('return maximum;', 'return maximum + 0;') },
];
const selected = argument('--case', 'all');
await mkdir(output, { recursive: true });

function checkJava(result: Verification) {
  assert.equal(result.current.compilation.exitCode, 0, result.current.compilation.stderr);
  assert.ok(!result.current.compilation.timedOut);
  assert.ok(result.current.runs.every(run => run.exitCode === 0 && !run.timedOut && !run.outputLimitExceeded));
  assert.equal(result.current.tests.status, 'passed', result.current.tests.report);
  assert.match(result.current.tests.report ?? '', /15 tests successful/);
}

async function coverage(name: string, files: SourceFile[], destination: string) {
  const docker = process.env.DOCKER_BIN || 'docker';
  const staging = resolve(destination, 'coverage-input');
  const classes = resolve(destination, 'coverage-classes');
  await mkdir(staging, { recursive: true });
  await mkdir(classes, { recursive: true });
  await chmod(staging, 0o755);
  await chmod(classes, 0o777);
  for (const file of files) await writeFile(resolve(staging, file.path), file.content, { mode: 0o644 });
  await copyFile(resolve(toolsDirectory, 'agent.jar'), resolve(staging, 'agent.jar'));
  await chmod(resolve(staging, 'agent.jar'), 0o644);
  const run = async (args: string[]) => {
    const id = `jbp-jury-${randomUUID()}`;
    try {
      return await runProcess(docker, ['run', '--pull=never', '--name', id, '--network=none', '--read-only',
        '--user=10001:10001', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=256m', '--memory-swap=256m',
        '--cpus=1', '--pids-limit=96', '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777',
        '--mount', `type=bind,src=${staging},dst=/input,readonly`, '--mount', `type=bind,src=${classes},dst=/classes`,
        process.env.RUNNER_IMAGE || 'javablueprint-runner:local', ...args], { timeoutMs: 30000, outputBytes: 2 * 1024 * 1024 });
    } finally {
      const removed = await runProcess(docker, ['rm', '-f', id], { timeoutMs: 5000 });
      assert.ok(removed.exitCode === 0 || /No such container/.test(removed.stderr));
    }
  };
  const compilation = await run(['javac', '-J-Xmx160m', '-J-XX:ActiveProcessorCount=1', '-Xlint:all', '-g', '-proc:none',
    '--release', '21', '-encoding', 'UTF-8', '-cp', '/opt/junit.jar', '-d', '/classes', ...files.map(file => `/input/${file.path}`)]);
  assert.equal(compilation.exitCode, 0, compilation.stderr);
  const junit = await run(['java', '-Xmx128m', '-XX:ActiveProcessorCount=1', `-javaagent:/input/agent.jar=destfile=/classes/coverage.exec,includes=${name}*,excludes=${name}Test*`,
    '-jar', '/opt/junit.jar', 'execute', '--class-path', '/classes', '--select-class', `${name}Test`, '--disable-banner', '--disable-ansi-colors', '--fail-if-no-tests']);
  assert.equal(junit.exitCode, 0, junit.stdout + junit.stderr);
  const report = await runProcess(process.env.JAVA_BIN || 'java', ['-Xmx128m', '-jar', resolve(toolsDirectory, 'cli.jar'),
    'report', resolve(classes, 'coverage.exec'), '--classfiles', classes, '--sourcefiles', staging,
    '--xml', resolve(destination, 'coverage.xml'), '--html', resolve(destination, 'coverage-html')], { timeoutMs: 20000 });
  assert.equal(report.exitCode, 0, report.stderr);
  const xml = await readFile(resolve(destination, 'coverage.xml'), 'utf8');
  const methods: { owner: string; name: string; descriptor: string; line: number; covered: boolean }[] = [];
  const counters: Record<string, { missed: number; covered: number }> = {};
  for (const match of xml.matchAll(/<class name="([^"]+)"[^>]*>([\s\S]*?)<\/class>/g)) {
    if (!(match[1] === name || match[1]!.startsWith(`${name}$`))) continue;
    for (const method of match[2]!.matchAll(/<method name="([^"]+)" desc="([^"]+)"(?: line="(\d+)")?>([\s\S]*?)<\/method>/g)) {
      methods.push({ owner: match[1]!, name: method[1]!, descriptor: method[2]!, line: Number(method[3] ?? 0),
        covered: /type="METHOD" missed="0" covered="1"/.test(method[4]!) });
    }
    const tail = match[2]!.replace(/<method[\s\S]*?<\/method>/g, '');
    for (const counter of tail.matchAll(/<counter type="([^"]+)" missed="(\d+)" covered="(\d+)"\/>/g)) {
      const value = counters[counter[1]!] ??= { missed: 0, covered: 0 };
      value.missed += Number(counter[2]); value.covered += Number(counter[3]);
    }
  }
  await rm(staging, { recursive: true, force: true });
  return { compilation, junit, counters, methods };
}

for (const scenario of cases.filter(value => selected === 'all' || value.folder === selected)) {
  const destination = resolve(output, scenario.folder);
  await mkdir(destination, { recursive: true });
  const report: Record<string, any> = { started: new Date().toISOString(), evaluatedRevision: '4334d84b96fbe7bed553ec557d0f768b12a62009', scenario };
  const save = () => writeFile(resolve(destination, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  try {
    const files = await Promise.all([`${scenario.name}.java`, `${scenario.name}Test.java`].map(async path => ({
      path, content: await readFile(new URL(`../examples/jury/${scenario.folder}/${path}`, import.meta.url), 'utf8'),
    })));
    report.sources = files.map(file => ({ path: file.path, lines: file.content.split('\n').length - 1,
      nonblank: file.content.split('\n').filter(line => line.trim()).length, sha256: createHash('sha256').update(file.content).digest('hex') }));
    assert.ok(report.sources[0].lines >= 1000);
    const inputs = ['', '0 1', '1 1', '12 7', scenario.max, '-5 3', 'invalid', '12 7'].map((stdin, index) => ({ name: `${index}:${stdin || 'empty'}`, stdin }));
    const started = performance.now();
    const parsed = await engine.process(files);
    assert.deepEqual(parsed.errors, []);
    const parseMs = Math.round(performance.now() - started);
    const layoutBegin = performance.now();
    const layout = graph(parsed);
    report.parse = { ms: parseMs, layoutMs: Math.round(performance.now() - layoutBegin), nodes: parsed.nodes.length,
      edges: parsed.edges.length, scopes: parsed.nodes.filter(node => node.kind === 'method' && node.source.file === `${scenario.name}.java`).length,
      warnings: parsed.warnings };
    assert.ok(layout.edges.every(edge => layout.nodes.some(node => node.id === edge.source) && layout.nodes.some(node => node.id === edge.target)));
    report.analysis = analyze(parsed);
    await writeFile(resolve(destination, 'ir.json'), JSON.stringify(parsed));
    await writeFile(resolve(destination, 'graph.json'), JSON.stringify(layout));
    report.baseline = await runner.verify(files, files, { mainClass: scenario.name, inputs }, 0);
    await save();
    checkJava(report.baseline);
    assert.equal(report.baseline.current.runs[3].stdout, report.baseline.current.runs[7].stdout);
    assert.equal(report.baseline.current.runs[0].stdout, report.baseline.current.runs[6].stdout);
    report.coverage = await coverage(scenario.name, files, destination);
    await save();
    console.log(`${scenario.name}: javac/JUnit=passed, parse=${parseMs}ms, scopes=${report.parse.scopes}, coverage=${JSON.stringify(report.coverage.counters)}`);
    const choose = (name: string, modify: (code: string) => string) => parsed.nodes.find(node => node.kind === 'method' && node.title === name && modify(node.code) !== node.code)!;
    const safeNode = choose(scenario.safe, scenario.safeChange), mutant = choose(scenario.mutation, scenario.mutate);
    assert.ok(safeNode && mutant);
    const variants: { name: string; good: boolean; operations: Transform[] }[] = [
      { name: 'safe visual method edit', good: true, operations: [{ type: 'replaceMethod', nodeId: safeNode.id, code: scenario.safeChange(safeNode.code) }] },
      { name: 'behavior mutation', good: false, operations: [{ type: 'replaceMethod', nodeId: mutant.id, code: scenario.mutate(mutant.code) }] },
    ];
    report.variants = [];
    for (const variant of variants) {
      const changed = await engine.process(files, parsed.identities, variant.operations);
      assert.deepEqual(changed.errors, []);
      const verification = await runner.verify(files, changed.files, { mainClass: scenario.name, inputs: [inputs[0]!, inputs[4]!] }, 1);
      const differences = verification.current.runs.filter(run => run.stdout !== report.baseline.current.runs.find((item: any) => item.name === run.name).stdout).map(run => run.name);
      report.variants.push({ ...variant, differences, verification });
      await save();
      assert.equal(verification.current.compilation.exitCode, 0, verification.current.compilation.stderr);
      if (variant.good) { checkJava(verification); assert.deepEqual(differences, []); }
      else assert.equal(verification.current.tests.status, 'failed', 'mutation escaped the independent oracle');
    }
    const generated = await engine.process(parsed.files, parsed.identities);
    assert.deepEqual(generated.errors, []);
    assert.deepEqual(generated.files, parsed.files, 'unmodified generation must preserve exact source bytes');
    report.finished = new Date().toISOString();
    console.log(`${scenario.name}: safe edit preserves output; mutant rejected by JUnit; source roundtrip exact`);
  } catch (error) {
    report.failure = String(error);
    console.error(`${scenario.name}: ${String(error)}`);
    process.exitCode = 1;
  }
  await save();
}
