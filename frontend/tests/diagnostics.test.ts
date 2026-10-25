import { test } from 'node:test';
import assert from 'node:assert/strict';

test('diagnostics preserve geometry, follow source aliases, honor severity and exclude other files or resolved issues', async () => {
  const { decorateDiagnostics } = await import(new URL('../src/lib/diagnostics.ts', import.meta.url).href);
  const nodes = [{ id: 'copy', position: { x: 17, y: 29 }, data: { title: 'loop', originId: 'origin', source: { file: 'Main.java', startLine: 3 }, blockType: 'loop' } },
    { id: 'clean', position: { x: 2, y: 3 }, data: { title: 'other', source: { file: 'Other.java', startLine: 3 }, blockType: 'loop' } }];
  const issues = [{ id: 'one', nodeId: 'origin', file: 'Main.java', line: 3, level: 'medium', title: 'Nested loop', description: 'Repeated traversal' },
    { id: 'two', nodeId: 'origin', file: 'Main.java', line: 3, level: 'high', title: 'Risk', description: 'Review' },
    { id: 'three', nodeId: 'clean', file: 'Other.java', line: 3, level: 'high', title: 'Resolved', description: 'Done', resolved: true }];
  const decorated = decorateDiagnostics(nodes, issues);
  assert.match(decorated[0].className, /diagnostic-high/);
  assert.equal(decorated[0].data.issueCount, 2);
  assert.deepEqual(decorated[0].position, nodes[0].position);
  assert.equal(decorated[1], nodes[1]);
  assert.equal(nodes[0].className, undefined);
  assert.equal(decorateDiagnostics(nodes, [])[0], nodes[0]);
  const copies = [nodes[0], { ...nodes[0], id: 'another-copy' }];
  const reportedCopy = [{ ...issues[0], nodeId: 'another-copy' }];
  assert.ok(decorateDiagnostics(copies, reportedCopy).every(node => node.data.issueCount === 1), 'all finally routes sharing an AST statement must show its diagnostic');
});
