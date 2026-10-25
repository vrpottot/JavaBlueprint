import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildApp } from '../src/app.js';
import { JavaParserEngine } from '../src/adapters/java-engine.js';
import { ProjectStore } from '../src/services/projects.js';
import { graph } from '../src/services/graph.js';
import { analyze } from '../src/services/analyzer.js';
import { compareVersions } from '../src/adapters/docker-runner.js';
import type { EngineResult, SourceFile, VersionResult } from '../src/types/index.js';

const app = buildApp();
const engine = new JavaParserEngine();
after(async () => { await app.close(); });
const sample = await readFile(new URL('../examples/Main.java', import.meta.url), 'utf8');
const parse = async (files: SourceFile[] = [{ path: 'Main.java', content: sample }]) => {
  const response = await app.inject({ method: 'POST', url: '/api/projects/parse', payload: { files } });
  assert.equal(response.statusCode, 201, response.body);
  return response.json();
};

test('real JavaParser creates source-linked IR and branched React Flow graph', async () => {
  const p = await parse();
  const branch = p.graph.nodes.find((n: any) => n.data.astKind === 'IfStmt');
  assert.equal(branch.type, 'conditionNode');
  assert.equal(branch.data.source.startLine, 5);
  assert.equal(branch.data.source.file, 'Main.java');
  assert.equal(p.graph.edges.filter((e: any) => e.source === branch.id).length, 2);
  assert.deepEqual(p.structure[0].mainClasses, ['Main']);
  const response = await app.inject(`/api/projects/${p.projectId}/ir`);
  assert.equal(response.statusCode, 200);
  assert.ok(response.json().nodes.some((n: any) => n.kind === 'return'));
});

test('condition edit changes AST, preserves IDs and refreshes source ranges', async () => {
  const p = await parse();
  const branch = p.graph.nodes.find((n: any) => n.data.astKind === 'IfStmt');
  const response = await app.inject({ method: 'POST', url: `/api/projects/${p.projectId}/transform`, payload: { revision: 0, operations: [{ type: 'updateCondition', nodeId: branch.id, code: 'value >= 1' }] } });
  assert.equal(response.statusCode, 200, response.body);
  const updated = response.json();
  assert.equal(updated.revision, 1);
  assert.ok(updated.files[0].content.includes('value >= 1'));
  assert.ok(updated.files[0].content.includes('import java.util.Scanner;'));
  assert.deepEqual(updated.graph.nodes.map((n: any) => n.id), p.graph.nodes.map((n: any) => n.id));
  const generated = await app.inject({ method: 'POST', url: `/api/projects/${p.projectId}/generate`, payload: {} });
  assert.equal(generated.json().syntaxValid, true);
  const stale = await app.inject({ method: 'POST', url: `/api/projects/${p.projectId}/transform`, payload: { revision: 0, operations: [{ type: 'deleteBlock', nodeId: branch.id }] } });
  assert.equal(stale.statusCode, 409);
});

test('add, duplicate, delete and initializer edits preserve unaffected node IDs', async () => {
  let result = await engine.process([{ path: 'Demo.java', content: 'class Demo { int f = 1; void work() { int x = 2; System.out.println(x); } }' }]);
  const field = result.nodes.find(n => n.astKind === 'FieldDeclaration')!;
  const local = result.nodes.find(n => n.astKind === 'ExpressionStmt' && n.kind === 'variable')!;
  const print = result.nodes.find(n => n.kind === 'operation')!;
  result = await engine.process(result.files, result.identities, [
    { type: 'updateVariable', nodeId: field.id, code: '5' },
    { type: 'updateVariable', nodeId: local.id, code: '3' },
    { type: 'addBlock', nodeId: local.id, code: 'x++;' },
    { type: 'duplicateBlock', nodeId: print.id },
  ]);
  assert.equal(result.errors.length, 0);
  assert.ok(result.files[0]!.content.includes('int f = 5'));
  assert.ok(result.files[0]!.content.includes('int x = 3'));
  assert.ok(result.nodes.some(n => n.id === print.id));
  assert.equal(new Set(result.nodes.map(n => n.id)).size, result.nodes.length);
  const added = result.nodes.find(n => n.code === 'x++;')!;
  result = await engine.process(result.files, result.identities, [{ type: 'deleteBlock', nodeId: added.id }]);
  assert.ok(!result.files[0]!.content.includes('x++;'));
  assert.ok(result.nodes.some(n => n.id === print.id));
});

test('failed transform batch rolls back the whole project', async () => {
  const p = await parse();
  const branch = p.graph.nodes.find((n: any) => n.data.astKind === 'IfStmt');
  const response = await app.inject({ method: 'POST', url: `/api/projects/${p.projectId}/transform`, payload: { revision: 0, operations: [{ type: 'updateCondition', nodeId: branch.id, code: 'true' }, { type: 'updateCondition', nodeId: branch.id, code: 'broken (' }] } });
  assert.equal(response.statusCode, 422);
  const current = (await app.inject(`/api/projects/${p.projectId}/graph`)).json();
  assert.equal(current.revision, 0);
  assert.equal(current.files[0].content, sample);
});

test('comments, Javadoc and string literal whitespace survive generation', async () => {
  const code = `/** Example. */
class Comments {
  // Field stays documented.
  int value = 1;
  /** Pick a value. */
  int pick(int n) {
    // Guard.
    if (n > 0) { return 1; } // Keep this comment.
    System.out.println("two  spaces");
    return 0;
  }
}`;
  const parsed = await engine.process([{ path: 'Comments.java', content: code }]);
  const condition = parsed.nodes.find(n => n.kind === 'condition')!;
  const updated = await engine.process(parsed.files, parsed.identities, [{ type: 'updateCondition', nodeId: condition.id, code: 'n >= 1' }]);
  for (const fragment of ['Example.', 'Field stays documented.', 'Pick a value.', 'Guard.', 'Keep this comment.', 'two  spaces']) assert.ok(updated.files[0]!.content.includes(fragment), fragment);
});

test('syntax errors include diagnostics and create no project', async () => {
  const response = await app.inject({ method: 'POST', url: '/api/projects/parse', payload: { code: 'public class Broken { void f( }' } });
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().projectId, null);
  assert.ok(response.json().errors[0].message);
});

test('invalid requests and unsafe paths are rejected', async () => {
  for (const payload of [{}, { files: [] }, { code: 'class A {}', extra: 'x' }, { files: [{ path: '../Main.java', content: sample }] }, { files: [{ path: '/Main.java', content: sample }] }, { files: [{ path: 'A.java', content: '' }, { path: 'A.java', content: '' }] }]) {
    const response = await app.inject({ method: 'POST', url: '/api/projects/parse', payload });
    assert.equal(response.statusCode, 400, response.body);
  }
  assert.equal((await app.inject('/api/projects/00000000-0000-0000-0000-000000000000/graph')).statusCode, 404);
});

test('Java 21 constructs survive round trip: interfaces, exceptions, loops, collections, lambda, record and enum', async () => {
  const code = `import java.util.*;
import java.nio.charset.StandardCharsets;
interface Work { int run(int n) throws Exception; }
record Pair(int x, String y) {}
enum State { OK, FAIL }
class Example implements Work {
  int field = 1;
  Example() { field = 2; }
  public int run(int n) throws Exception {
    List<String> xs = new ArrayList<>(List.of("a", "b"));
    Map<String,Integer> map = new HashMap<>(Map.of("a", 1));
    Optional<String> first = xs.stream().filter(x -> !x.isEmpty()).findFirst();
    int total = 0;
    for (int i=0; i<n; i++) { if(i==2) continue; total += i; }
    for (String x : xs) { if(x.isEmpty()) break; }
    while (total < 10) total++;
    do { total--; } while (total > 10);
    switch (n) { case 1: total++; break; default: total--; }
    try { if(n<0) throw new Exception("negative"); }
    catch(Exception ex) { System.err.println(ex.getMessage()); }
    finally { System.out.printf("%s", String.format("%d", total)); }
    byte[] bytes = "ok".getBytes(StandardCharsets.UTF_8);
    return total;
  }
}`;
  const result = await engine.process([{ path: 'Example.java', content: code }]);
  assert.deepEqual(result.errors, []);
  const field = result.nodes.find(n => n.astKind === 'FieldDeclaration')!;
  const updated = await engine.process(result.files, result.identities, [{ type: 'updateVariable', nodeId: field.id, code: '4' }]);
  assert.deepEqual(updated.errors, []);
  for (const token of ['interface Work', 'record Pair', 'enum State', 'finally', 'StandardCharsets.UTF_8', '.filter(']) assert.ok(updated.files[0]!.content.includes(token), token);
  assert.ok(updated.warnings.length > 0);
  const g = graph(updated);
  assert.ok(g.edges.every(e => g.nodes.some(n => n.id === e.source) && g.nodes.some(n => n.id === e.target)));
});

test('analysis reports long methods and nested loops without fabricated complexity or coverage', async () => {
  const code = `class Big { void work(int n) {\nfor(int i=0;i<n;i++) { for(int j=0;j<n;j++) { System.out.println(i+j); } }\n${Array.from({length:55}, (_,i) => `int v${i} = ${i};`).join('\n')}\n} }`;
  const result = analyze(await engine.process([{ path: 'Big.java', content: code }]));
  assert.ok(result.diagnostics.some(d => d.type === 'long_method'));
  assert.ok(result.diagnostics.some(d => d.type === 'nested_loop'));
  assert.equal(result.complexity[0]!.estimate, 'O(n^2)');
  assert.ok(result.complexity[0]!.assumptions.some(a => a.includes('ожидание ОС')));
  assert.equal(result.complexity[0]!.structuralBound, 'O(n^2)');
  assert.equal(result.metrics.testCoverage, null);
});

test('1000-line monolith parses, produces a graph and remains editable', async () => {
  const code = `public class Monolith {\n${Array.from({length:125}, (_,i) => `  public int method${i}(int value) {\n    int result = value;\n    if (value > ${i}) {\n      result++;\n    }\n    result += ${i};\n    return result;\n  }`).join('\n')}\n}`;
  assert.ok(code.split('\n').length >= 1000);
  const parsed = await engine.process([{ path: 'Monolith.java', content: code }]);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.nodes.filter(n => n.kind === 'method').length, 125);
  const condition = parsed.nodes.find(n => n.kind === 'condition')!;
  const updated = await engine.process(parsed.files, parsed.identities, [{ type: 'updateCondition', nodeId: condition.id, code: 'value >= 1' }]);
  assert.equal(updated.nodes.length, parsed.nodes.length);
  assert.equal(updated.nodes.find(n => n.id === condition.id)!.snippet, 'value >= 1');
});

test('source update keeps the original upload and deleted projects return 404', async () => {
  const p = await parse();
  const response = await app.inject({ method: 'PUT', url: `/api/projects/${p.projectId}/sources`, payload: { revision: 0, files: [{ path: 'Main.java', content: sample.replace('> 0', '>= 0') }] } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().revision, 1);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/projects/${p.projectId}` })).statusCode, 204);
  assert.equal((await app.inject(`/api/projects/${p.projectId}/graph`)).statusCode, 404);
});

test('project capacity is explicit and expired projects are cleaned up', () => {
  const store = new ProjectStore(1000, 1);
  const empty = { files: [], nodes: [], edges: [], identities: [], errors: [], warnings: [], structure: [] } satisfies EngineResult;
  const p = store.create(empty);
  assert.throws(() => store.create(empty), /capacity/);
  p.touchedAt = Date.now() - 1001;
  assert.throws(() => store.get(p.id), /expired/);
  assert.ok(store.create(empty).id);
});

test('comparison distinguishes matching samples, differences, failures and missing evidence', () => {
  const run = { stdout: '1\n', stderr: '', exitCode: 0, durationMs: 1, timedOut: false, outputLimitExceeded: false };
  const original: VersionResult = { compilation: run, runs: [{ ...run, name: 'one', passed: null }], tests: { status: 'not_run', cases: [] } };
  assert.equal(compareVersions(original, original, 1).status, 'matched_on_inputs');
  assert.equal(compareVersions(original, original, 1).provenEquivalent, false);
  const changed = structuredClone(original); changed.runs[0]!.stdout = '0\n';
  assert.equal(compareVersions(original, changed, 1).status, 'different');
  changed.runs[0]!.timedOut = true;
  assert.equal(compareVersions(original, changed, 1).status, 'inconclusive');
  assert.equal(compareVersions(original, original, 0).status, 'inconclusive');
});

test('AI proposal cannot bypass verification or mutate on missing evidence', async () => {
  const p = await parse();
  const branch = p.graph.nodes.find((n: any) => n.data.astKind === 'IfStmt');
  const response = await app.inject({ method: 'POST', url: `/api/projects/${p.projectId}/ai-proposals`, payload: { revision: 0, operations: [{ type: 'updateCondition', nodeId: branch.id, code: 'true' }], verification: {} } });
  assert.equal(response.statusCode, 400);
  const context = await app.inject(`/api/projects/${p.projectId}/ai-context`);
  assert.equal(context.json().revision, 0);
  assert.ok(context.json().analysis);
});

test('production gateway key protects processing routes and leaves health public', async () => {
  const previous = process.env.BACKEND_API_KEY;
  process.env.BACKEND_API_KEY = 'integration-gateway-key';
  const secured = buildApp();
  if (previous === undefined) delete process.env.BACKEND_API_KEY; else process.env.BACKEND_API_KEY = previous;
  try {
    assert.equal((await secured.inject('/api/health')).statusCode, 200);
    const options = { method: 'POST' as const, url: '/api/projects/parse', payload: { code: 'class A {}', filename: 'A.java' } };
    assert.equal((await secured.inject(options)).statusCode, 401);
    assert.equal((await secured.inject({ ...options, headers: { 'x-backend-key': 'wrong' } })).statusCode, 401);
    assert.equal((await secured.inject({ ...options, headers: { 'x-backend-key': 'integration-gateway-key' } })).statusCode, 201);
  } finally { await secured.close(); }
});
