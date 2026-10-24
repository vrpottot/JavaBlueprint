import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildApp } from '../src/app.js';
import { DockerRunner } from '../src/adapters/docker-runner.js';
import { runProcess } from '../src/adapters/process.js';
import type { SourceFile } from '../src/types/index.js';

// Opt-in integration tests never fall back to running submitted classes on the host.
const enabled = process.env.RUN_DOCKER_TESTS === '1';
const app = buildApp();
const runner = new DockerRunner();
after(async () => { await app.close(); });
const sample = await readFile(new URL('../examples/Main.java', import.meta.url), 'utf8');
const tests = await readFile(new URL('../examples/MainTest.java', import.meta.url), 'utf8');
const files: SourceFile[] = [{ path: 'Main.java', content: sample }];

test('full API cycle: upload → graph → condition → Java → javac → JUnit → comparison', { skip: !enabled, timeout: 120000 }, async () => {
  const parsed = await app.inject({ method: 'POST', url: '/api/projects/parse', payload: { files } });
  assert.equal(parsed.statusCode, 201, parsed.body);
  const p = parsed.json();
  const condition = p.graph.nodes.find((n: any) => n.data.astKind === 'IfStmt');
  const transformed = await app.inject({ method: 'POST', url: `/api/projects/${p.projectId}/transform`, payload: { revision: 0, operations: [{ type: 'updateCondition', nodeId: condition.id, code: 'value >= 1' }] } });
  assert.equal(transformed.statusCode, 200, transformed.body);
  const generated = await app.inject({ method: 'POST', url: `/api/projects/${p.projectId}/generate`, payload: {} });
  assert.equal(generated.json().syntaxValid, true);
  const response = await app.inject({ method: 'POST', url: `/api/projects/${p.projectId}/verify`, payload: {
    revision: 1, mainClass: 'Main', tests: [{ path: 'MainTest.java', content: tests }], compare: true,
    inputs: [{ name: 'positive', stdin: '3\n', expectedStdout: '1\n' }, { name: 'negative', stdin: '-3\n', expectedStdout: '0\n' }, { name: 'zero', stdin: '0\n', expectedStdout: '0\n' }],
  } });
  assert.equal(response.statusCode, 200, response.body);
  const verification = response.json();
  assert.equal(verification.current.compilation.exitCode, 0, JSON.stringify(verification));
  assert.equal(verification.current.tests.status, 'passed', JSON.stringify(verification));
  assert.equal(verification.original.tests.status, 'passed');
  assert.equal(verification.comparison.status, 'matched_on_inputs');
  assert.equal(verification.comparison.checkedInputs, 3);
  assert.equal(verification.comparison.provenEquivalent, false);
});

test('runner returns real javac diagnostics, failing tests and changed behavior', { skip: !enabled, timeout: 120000 }, async () => {
  const invalid = [{ path: 'Main.java', content: 'public class Main { public static void main(String[] args) { missing(); } }' }];
  const failed = await runner.verify(invalid, invalid, { mainClass: 'Main' }, 0);
  assert.notEqual(failed.current.compilation.exitCode, 0);
  assert.match(failed.current.compilation.stderr, /cannot find symbol/);
  assert.equal(failed.current.runs.length, 0);
  const changed = [{ path: 'Main.java', content: sample.replace('value > 0', 'value >= 0') }];
  const result = await runner.verify(files, changed, { mainClass: 'Main', inputs: [{ name: 'zero', stdin: '0\n' }], compare: true }, 1);
  assert.equal(result.comparison.status, 'different');
  const failing = await runner.verify(files, changed, { tests: [{ path: 'MainTest.java', content: tests }] }, 1);
  assert.equal(failing.current.tests.status, 'failed');
  assert.match(failing.current.tests.report!, /expected: <0> but was: <1>/);
});

test('infinite loops time out, output is bounded, filesystem and networking are isolated', { skip: !enabled, timeout: 120000 }, async () => {
  const endless = [{ path: 'Loop.java', content: 'public class Loop { public static void main(String[] args) { while(true) {} } }' }];
  const timed = await runner.verify(endless, endless, { mainClass: 'Loop' }, 0);
  assert.equal(timed.current.runs[0]!.timedOut, true);
  const flood = [{ path: 'Flood.java', content: 'public class Flood { public static void main(String[] args) { while(true) System.out.println("x".repeat(10000)); } }' }];
  const bounded = await runner.verify(flood, flood, { mainClass: 'Flood' }, 0);
  assert.equal(bounded.current.runs[0]!.outputLimitExceeded, true);
  const sandbox: SourceFile[] = [{ path: 'Sandbox.java', content: `import java.nio.file.*;
import java.net.*;
public class Sandbox {
 public static void main(String[] args) throws Exception {
  System.out.println(System.getProperty("user.name"));
  try { Files.writeString(Path.of("/classes/escape.txt"),"x"); throw new AssertionError("writable classes"); } catch(java.io.IOException expected) { System.out.println("readonly"); }
  try { new Socket().connect(new InetSocketAddress("1.1.1.1",443),200); throw new AssertionError("network"); } catch(java.io.IOException expected) { System.out.println("offline"); }
 }
}` }];
  const isolated = await runner.verify(sandbox, sandbox, { mainClass: 'Sandbox' }, 0);
  assert.equal(isolated.current.runs[0]!.exitCode, 0, JSON.stringify(isolated));
  assert.equal(isolated.current.runs[0]!.stdout, 'runner\nreadonly\noffline\n');
  const containers = await runProcess(process.env.DOCKER_BIN || 'docker', ['ps', '-aq', '--filter', 'name=jbp-']);
  const volumes = await runProcess(process.env.DOCKER_BIN || 'docker', ['volume', 'ls', '-q', '--filter', 'name=jbp-classes-']);
  assert.equal(containers.stdout.trim(), '');
  assert.equal(volumes.stdout.trim(), '');
});

test('AI proposals are applied only after compilation and identical-input checks', { skip: !enabled, timeout: 120000 }, async () => {
  const p = (await app.inject({ method: 'POST', url: '/api/projects/parse', payload: { files } })).json();
  const branch = p.graph.nodes.find((n: any) => n.data.astKind === 'IfStmt');
  const endpoint = `/api/projects/${p.projectId}/ai-proposals`;
  const verification = { mainClass: 'Main', inputs: [{ name: 'zero', stdin: '0\n' }], tests: [{ path: 'MainTest.java', content: tests }] };
  const rejected = await app.inject({ method: 'POST', url: endpoint, payload: { revision: 0, operations: [{ type: 'updateCondition', nodeId: branch.id, code: 'value >= 0' }], verification } });
  assert.equal(rejected.statusCode, 422, rejected.body);
  assert.equal((await app.inject(`/api/projects/${p.projectId}/graph`)).json().revision, 0);
  const accepted = await app.inject({ method: 'POST', url: endpoint, payload: { revision: 0, operations: [{ type: 'updateCondition', nodeId: branch.id, code: 'value >= 1' }], verification } });
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal(accepted.json().revision, 1);
  assert.equal(accepted.json().verification.comparison.provenEquivalent, false);
});

test('missing Docker returns a service error, never a local execution fallback', async () => {
  const unavailable = new DockerRunner('/nonexistent/docker');
  await assert.rejects(unavailable.verify(files, files, { mainClass: 'Main' }, 0), /Cannot start/);
});
