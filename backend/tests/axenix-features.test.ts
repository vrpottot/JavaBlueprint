import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildApp } from '../src/app.js';
import type { SourceFile } from '../src/types/index.js';

const app = buildApp();
after(async () => { await app.close(); });

test('JavaParser engine parses and generates graph for all Axenix Java requirements', async () => {
  const content = await readFile(new URL('../examples/AxenixDemo.java', import.meta.url), 'utf8');
  const files: SourceFile[] = [{ path: 'AxenixDemo.java', content }];

  const response = await app.inject({
    method: 'POST',
    url: '/api/projects/parse',
    payload: { files }
  });

  assert.equal(response.statusCode, 201, response.body);
  const data = response.json();
  assert.ok(data.projectId);
  assert.ok(data.graph);
  assert.ok(data.graph.nodes.length > 0);

  // Check Category 1: Methods, constructors, loops, switch
  const kinds = data.graph.nodes.map((n: any) => n.data.astKind);
  assert.ok(kinds.includes('ConstructorDeclaration'), 'Should detect ConstructorDeclaration');
  assert.ok(kinds.includes('MethodDeclaration'), 'Should detect MethodDeclaration');
  assert.ok(kinds.includes('ForEachStmt'), 'Should detect ForEachStmt');
  assert.ok(kinds.includes('SwitchStmt'), 'Should detect SwitchStmt');

  // Check Category 4: TryStmt and ThrowStmt
  assert.ok(kinds.includes('TryStmt'), 'Should detect TryStmt');
  assert.ok(kinds.includes('ThrowStmt'), 'Should detect ThrowStmt');

  // Verify structure extraction has AxenixDemo class
  const types = data.structure[0].types;
  assert.ok(types.includes('AxenixDemo'), 'Should detect AxenixDemo type');
  assert.ok(types.includes('DataProcessor'), 'Should detect DataProcessor interface');
  assert.ok(types.includes('ProcessingException'), 'Should detect ProcessingException class');
  assert.deepEqual(data.structure[0].mainClasses, ['demo.AxenixDemo']);
});
