import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JavaParserEngine } from '../src/adapters/java-engine.js';
import { graph } from '../src/services/graph.js';

test('switch entries and unbraced returns support statement edits; additions precede terminal exits', async () => {
  const engine = new JavaParserEngine();
  const parsed = await engine.process([{ path: 'Main.java', content: 'class Main { int f(int tier) { int p=0; switch(tier) { case 1: p=6; break; default: p=0; } if(p>0) return p; return 0; } }' }]);
  const assignment = parsed.nodes.find(n => n.code === 'p = 6;')!;
  assert.ok(assignment.editable.includes('replaceStatement'));
  const branchReturn = parsed.nodes.find(n => n.code === 'return p;')!;
  assert.ok(branchReturn.editable.includes('replaceStatement'));
  const stop = parsed.nodes.find(n => n.astKind === 'BreakStmt')!;
  const method = parsed.nodes.find(n => n.title === 'f')!;
  const changed = await engine.process(parsed.files, parsed.identities, [
    { type: 'replaceStatement', nodeId: assignment.id, code: 'p = 8;' },
    { type: 'replaceStatement', nodeId: branchReturn.id, code: 'return p + 1;' },
    { type: 'addBlock', nodeId: stop.id, code: 'p++;' },
    { type: 'addBlock', nodeId: method.id, code: 'int extra = 0;' },
  ]);
  assert.deepEqual(changed.errors, []);
  const source = changed.files[0]!.content;
  assert.ok(source.indexOf('p++;') < source.indexOf('break;'));
  assert.ok(source.indexOf('int extra = 0;') < source.indexOf('return 0;'));
  assert.ok(changed.nodes.some(n => n.id === assignment.id && n.code === 'p = 8;'));
});

test('graph resolves labeled jumps, hides opaque expression internals and separates branches without overlapping nodes', async () => {
  const parsed = await new JavaParserEngine().process([{ path: 'Main.java', content: `class Main {
    int labeled(int n) { int x=0; search: for(int i=0;i<n;i++) { for(int j=0;j<n;j++) { if(j==2) break search; if(j==1) continue search; x++; } } return x; }
    int lambda() { java.util.function.IntUnaryOperator op = v -> { if(v<0) return 0; return v; }; return op.applyAsInt(1); }
    int expression(int x) { return switch(x) { case 1 -> { int v=1; yield v; } default -> 0; }; }
    int cleanup() { try { return 1; } finally { System.out.println(1); } }
    record Coordinate(int row, int column) { Coordinate { if(row<0) throw new IllegalArgumentException("row"); } }
  }` }]);
  const stop = parsed.nodes.find(n => n.code === 'break search;')!;
  const next = parsed.nodes.find(n => n.code === 'continue search;')!;
  const end = parsed.nodes.find(n => n.code === 'return x;')!;
  const outer = parsed.nodes.find(n => n.astKind === 'ForStmt' && n.snippet === 'i < n')!;
  assert.ok(parsed.edges.some(e => e.source === stop.id && e.target === end.id));
  assert.ok(parsed.edges.some(e => e.source === next.id && e.target === outer.id));
  assert.ok(!parsed.nodes.some(n => n.astKind === 'YieldStmt' || n.code === 'return v;'));
  assert.ok(parsed.nodes.some(n => n.astKind === 'TryStmt' && n.warning?.includes('finally')));
  assert.ok(outer.displayCode?.includes('int i = 0; i < n; i++'));
  const compact = parsed.nodes.find(n => n.astKind === 'CompactConstructorDeclaration')!;
  const validation = parsed.nodes.find(n => n.snippet === 'row < 0')!;
  assert.equal(compact.kind, 'method');
  assert.equal(compact.methodId, compact.id);
  assert.equal(validation.methodId, compact.id);
  assert.ok(compact.warning?.includes('неявные присваивания'));
  assert.ok(parsed.edges.some(e => e.source === compact.id && e.target === validation.id));
  const edited = await new JavaParserEngine().process(parsed.files, parsed.identities, [{ type: 'addBlock', nodeId: compact.id, code: 'column = Math.max(column, 0);' }]);
  assert.deepEqual(edited.errors, []);
  assert.ok(edited.nodes.some(n => n.methodId === compact.id && n.code === 'column = Math.max(column, 0);'));
  const result = graph(parsed);
  assert.ok(result.edges.some(e => e.source === next.id && e.targetHandle === 'loop-in'));
  assert.ok(result.edges.every(e => result.nodes.some(n => n.id === e.source) && result.nodes.some(n => n.id === e.target)));
  for (let i=0;i<result.nodes.length;i++) for(let j=i+1;j<result.nodes.length;j++) {
    const a=result.nodes[i]!, b=result.nodes[j]!;
    const width=(n: typeof a) => n.data.blockType === 'condition' ? 500 : 400;
    const height=(n: typeof a) => n.data.blockType === 'condition' ? 320 : n.data.warning ? 300 : 240;
    const overlap = Math.min(a.position.x+width(a),b.position.x+width(b))>Math.max(a.position.x,b.position.x) && Math.min(a.position.y+height(a),b.position.y+height(b))>Math.max(a.position.y,b.position.y);
    assert.ok(!overlap, `${a.data.title} overlaps ${b.data.title}`);
  }
});
