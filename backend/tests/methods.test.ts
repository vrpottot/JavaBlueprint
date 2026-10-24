import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { JavaParserEngine } from '../src/adapters/java-engine.js';

test('method lifecycle is atomic, source-linked, stable and preview does not mutate the project', async () => {
  const app = buildApp();
  try {
    const created = await app.inject({ method: 'POST', url: '/api/projects/parse', payload: { filename: 'Empty.java', code: 'import java.util.List; public class Empty { int existing = 1; }' } });
    assert.equal(created.statusCode, 201, created.body);
    let project = created.json();
    const owner = project.containers.find((c: any) => c.name === 'Empty');
    assert.ok(owner.canAddMethods);
    const operation = { type: 'addMethod', nodeId: owner.id, code: '/** Doubles a number. */ public static int twice(int value) { if(value > 0) return value * 2; return 0; }' };
    const preview = await app.inject({ method: 'POST', url: `/api/projects/${project.projectId}/transform/preview`, payload: { revision: 0, operations: [operation] } });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(preview.json().syntaxValid, true);
    assert.equal((await app.inject(`/api/projects/${project.projectId}/graph`)).json().revision, 0);
    const saved = await app.inject({ method: 'POST', url: `/api/projects/${project.projectId}/transform`, payload: { revision: 0, operations: [operation] } });
    assert.equal(saved.statusCode, 200, saved.body);
    project = saved.json();
    const method = project.graph.nodes.find((n: any) => n.data.title === 'twice');
    const branch = project.graph.nodes.find((n: any) => n.data.astKind === 'IfStmt');
    assert.ok(method.data.method.body.includes('return value * 2;'));
    assert.equal(method.data.containerId, owner.id);
    assert.equal(project.changes[0].nodeId, method.id);
    assert.ok(project.graph.edges.some((e: any) => e.source === method.id && e.target === branch.id));
    assert.ok(project.files[0].content.includes('import java.util.List;'));
    const update = await app.inject({ method: 'POST', url: `/api/projects/${project.projectId}/transform`, payload: { revision: 1, operations: [{ type: 'replaceMethod', nodeId: method.id, code: `public static int doubled(int value) {${method.data.method.body}}` }] } });
    assert.equal(update.statusCode, 200, update.body);
    project = update.json();
    assert.ok(project.graph.nodes.some((n: any) => n.id === method.id && n.data.title === 'doubled'));
    assert.ok(project.graph.nodes.some((n: any) => n.id === branch.id));
    assert.ok(project.files[0].content.includes('Doubles a number.'));
    const duplicate = await app.inject({ method: 'POST', url: `/api/projects/${project.projectId}/transform`, payload: { revision: 2, operations: [{ type: 'duplicateMethod', nodeId: method.id }] } });
    assert.equal(duplicate.statusCode, 200, duplicate.body);
    project = duplicate.json();
    const copy = project.graph.nodes.find((n: any) => n.data.title === 'doubledCopy');
    assert.ok(copy);
    assert.equal(new Set(project.graph.nodes.map((n: any) => n.id)).size, project.graph.nodes.length);
    const removed = await app.inject({ method: 'POST', url: `/api/projects/${project.projectId}/transform`, payload: { revision: 3, operations: [{ type: 'deleteMethod', nodeId: copy.id }] } });
    assert.equal(removed.statusCode, 200, removed.body);
    assert.ok(!removed.json().files[0].content.includes('doubledCopy'));
    const invalid = await app.inject({ method: 'POST', url: `/api/projects/${project.projectId}/transform`, payload: { revision: 4, operations: [{ type: 'addMethod', nodeId: owner.id, code: 'public int broken( {' }] } });
    assert.equal(invalid.statusCode, 422);
    assert.equal((await app.inject(`/api/projects/${project.projectId}/graph`)).json().revision, 4);
  } finally { await app.close(); }
});

test('method validation rejects erased duplicates, constructors and invalid interface methods while allowing overloads', async () => {
  const engine = new JavaParserEngine();
  const parsed = await engine.process([{ path: 'Types.java', content: 'import java.util.*; class Types<T extends Number> { int f(String x) { return 0; } void g(List<String> xs) {} void h(int... xs) {} void generic(T value) {} } interface Worker {}' }]);
  const owner = parsed.containers!.find(c => c.name === 'Types')!;
  const iface = parsed.containers!.find(c => c.name === 'Worker')!;
  for (const [nodeId, code] of [
    [owner.id, 'String f(java.lang.String other) { return other; }'],
    [owner.id, 'void g(java.util.List<Integer> other) {}'],
    [owner.id, 'void h(int[] other) {}'],
    [owner.id, 'void generic(Number other) {}'],
    [owner.id, 'Types() {}'],
    [owner.id, 'void injected() {} int field;'],
    [iface.id, 'void execute() {}'],
  ]) {
    await assert.rejects(engine.process(parsed.files, parsed.identities, [{ type: 'addMethod', nodeId: nodeId!, code }]), { code: 'UNSUPPORTED_TRANSFORM' }, code);
  }
  const overloaded = await engine.process(parsed.files, parsed.identities, [{ type: 'addMethod', nodeId: owner.id, code: 'int f(int x) { return x; }' }]);
  assert.equal(overloaded.nodes.filter(n => n.title === 'f').length, 2);
});

test('named nested classes, interfaces, records and enums support correct method placement and generic signatures', async () => {
  const engine = new JavaParserEngine();
  const parsed = await engine.process([{ path: 'Models.java', content: 'class Models { static class Nested {} } interface Worker {} record Pair(int value) {} enum Mode { ON, OFF }' }]);
  const id = (name: string) => parsed.containers!.find(c => c.name === name)!.id;
  const updated = await engine.process(parsed.files, parsed.identities, [
    { type: 'addMethod', nodeId: id('Models.Nested'), code: 'public static <T> T identity(T value) { return value; }' },
    { type: 'addMethod', nodeId: id('Worker'), code: 'void execute();' },
    { type: 'addMethod', nodeId: id('Worker'), code: 'default int count() { return 1; }' },
    { type: 'addMethod', nodeId: id('Pair'), code: 'public int twice() { return value * 2; }' },
    { type: 'addMethod', nodeId: id('Mode'), code: 'public boolean enabled() { return this == ON; }' },
  ]);
  assert.deepEqual(updated.errors, []);
  assert.equal(updated.nodes.find(n => n.title === 'identity')!.containerId, id('Models.Nested'));
  assert.ok(updated.nodes.find(n => n.title === 'identity')!.method!.signature.includes('<T>'));
  assert.equal(updated.nodes.find(n => n.title === 'execute')!.method!.hasBody, false);
});
