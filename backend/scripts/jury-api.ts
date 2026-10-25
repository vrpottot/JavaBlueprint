import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { EngineResult, IRNode, SourceFile, Transform } from '../src/types/index.js';

const arg = (flag: string, fallback: string) => process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1]! : fallback;
const base = arg('--url', 'http://127.0.0.1:5173');
const output = resolve(arg('--output', '/tmp/javascope-jury/api'));
await mkdir(output, { recursive: true });
const report: Record<string, any> = { base, started: new Date().toISOString(), checks: [] };
const save = () => writeFile(resolve(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
async function request(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120000) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); report.checks.push({ name, passed: true }); }
  catch (error) { report.checks.push({ name, passed: false, error: String(error) }); }
  await save();
}
report.health = (await request('/health')).body;
const files: SourceFile[] = await Promise.all(['CostTraps.java', 'CostTrapsTest.java'].map(async path => ({
  path, content: await readFile(new URL(`../examples/jury/${path}`, import.meta.url), 'utf8'),
})));
const created = await request('/projects/parse', { files });
assert.equal(created.status, 201, JSON.stringify(created.body));
const projectId = created.body.projectId as string;
try {
  const ir = (await request(`/projects/${projectId}/ir`)).body.ir as EngineResult | undefined;
  const raw = ir ?? (await request(`/projects/${projectId}/ir`)).body as EngineResult;
  const nodes: IRNode[] = raw.nodes;
  assert.ok(nodes);
  const analysis = (await request(`/projects/${projectId}/analyze`, {})).body;
  report.analysis = analysis;
  const verification = await request(`/projects/${projectId}/verify`, { revision: 0, tests: [], compare: false });
  report.verification = verification;
  await check('real JUnit reproduces exact cubic work and null/finally semantics', async () => {
    assert.equal(verification.status, 200);
    assert.equal(verification.body.current.tests.status, 'passed');
    assert.match(verification.body.current.tests.report, /2 tests successful/);
  });
  for (const name of ['boxedSwitch', 'unboxing']) {
    const method = nodes.find(node => node.kind === 'method' && node.title === name)!;
    const returned = nodes.find(node => node.methodId === method.id && node.astKind === 'ReturnStmt')!;
    const exceptional = raw.edges.filter(edge => edge.source === returned.id && edge.kind === 'exception');
    report[`${name}Flow`] = { method, returned, exceptional };
    await check(`${name} has an implicit exception route before return`, async () => assert.ok(exceptional.length > 0));
  }
  const alias = analysis.complexity.find((cost: any) => cost.method === 'aliasBuilder');
  const helper = analysis.complexity.find((cost: any) => cost.method === 'growingHelper');
  await check('growing builder alias is not claimed linear', async () => assert.notEqual(alias.estimate, 'O(n)'));
  await check('helper-grown traversal is not claimed quadratic', async () => assert.notEqual(helper.estimate, 'O(n^2)'));
  const node = nodes.find(value => value.kind === 'method' && value.title === 'aliasBuilder')!;
  const before = (await request(`/projects/${projectId}/graph`)).body;
  await check('invalid source preserves project revision and source bytes', async () => {
    const failed = await request(`/projects/${projectId}/sources`, { revision: 0, files: [{ path: 'CostTraps.java', content: 'public class CostTraps { int broken( { }' }] }, 'PUT');
    assert.equal(failed.status, 422);
    const after = (await request(`/projects/${projectId}/graph`)).body;
    assert.equal(after.revision, 0); assert.deepEqual(after.files, before.files);
  });
  await check('failed transform batch rolls back all operations', async () => {
    const operations: Transform[] = [{ type: 'replaceMethod', nodeId: node.id, code: node.code.replace("first.append('a')", "first.append('b')") },
      { type: 'replaceMethod', nodeId: node.id, code: 'invalid method !!!' }];
    const failed = await request(`/projects/${projectId}/transform`, { revision: 0, operations });
    assert.equal(failed.status, 422);
    assert.deepEqual((await request(`/projects/${projectId}/graph`)).body.files, before.files);
  });
  await check('revision conflicts reject stale writes', async () => {
    const stale = await request(`/projects/${projectId}/transform`, { revision: 9, operations: [{ type: 'replaceMethod', nodeId: node.id, code: node.code }] });
    assert.equal(stale.status, 409);
  });
  await check('path traversal and unknown JSON fields are rejected', async () => {
    assert.equal((await request('/projects/parse', { files: [{ path: '../Escape.java', content: 'class Escape {}' }] })).status, 400);
    assert.equal((await request('/projects/parse', { files, unexpected: true })).status, 400);
  });
  await check('source generation preserves exact bytes', async () => {
    assert.deepEqual((await request(`/projects/${projectId}/generate`, {})).body.files, files);
  });
} finally { await request(`/projects/${projectId}`, undefined, 'DELETE'); }

await check('a valid finally block with an ordinary comment imports successfully', async () => {
  const content = await readFile(new URL('../examples/jury/FinallyComment.java', import.meta.url), 'utf8');
  const result = await request('/projects/parse', { files: [{ path: 'FinallyComment.java', content }] });
  report.finallyComment = result;
  if (result.status === 201) await request(`/projects/${result.body.projectId}`, undefined, 'DELETE');
  assert.equal(result.status, 201, JSON.stringify(result.body));
});

const clearingFiles = await Promise.all(['ClearingHouse.java', 'ClearingHouseTest.java'].map(async path => ({
  path, content: await readFile(new URL(`../examples/jury/clearing/${path}`, import.meta.url), 'utf8'),
})));
const bank = (await request('/projects/parse', { files: clearingFiles })).body;
try {
  const irBody = (await request(`/projects/${bank.projectId}/ir`)).body;
  const nodes = (irBody.ir ?? irBody).nodes as IRNode[];
  const fee = nodes.find(node => node.title === 'fee' && node.kind === 'method')!;
  await check('AI verification gate rejects a compilable mutation caught by tests', async () => {
    const result = await request(`/projects/${bank.projectId}/ai-proposals`, { revision: 0,
      operations: [{ type: 'replaceMethod', nodeId: fee.id, code: fee.code.replace('Math.min(500,', 'Math.min(499,') }],
      verification: { mainClass: 'ClearingHouse', inputs: [{ name: 'empty scenario', stdin: '0 1' }] } });
    report.aiRejected = result;
    assert.equal(result.status, 422);
    assert.equal(result.body.error.code, 'AI_VERIFICATION_FAILED');
    assert.equal((await request(`/projects/${bank.projectId}/graph`)).body.revision, 0);
  });
} finally { await request(`/projects/${bank.projectId}`, undefined, 'DELETE'); }
report.finished = new Date().toISOString();
await save();
console.log(JSON.stringify(report.checks));
if (report.checks.some((item: any) => !item.passed)) process.exitCode = 1;
