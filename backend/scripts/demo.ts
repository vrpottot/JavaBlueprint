import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = process.env.API_URL || 'http://127.0.0.1:3001/api';
async function post(path: string, body: unknown): Promise<any> {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
}
const code = await readFile(new URL('../examples/Main.java', import.meta.url), 'utf8');
const tests = await readFile(new URL('../examples/MainTest.java', import.meta.url), 'utf8');
const p = await post('/projects/parse', { code, filename: 'Main.java' });
try {
  const condition = p.graph.nodes.find((n: any) => n.data.astKind === 'IfStmt');
  await post(`/projects/${p.projectId}/transform`, { revision: 0, operations: [{ type: 'updateCondition', nodeId: condition.id, code: 'value >= 1' }] });
  const generated = await post(`/projects/${p.projectId}/generate`, {});
  assert.equal(generated.syntaxValid, true);
  const result = await post(`/projects/${p.projectId}/verify`, { revision: 1, mainClass: 'Main', compare: true,
    tests: [{ path: 'MainTest.java', content: tests }], inputs: [{ name: 'positive', stdin: '3\n' }, { name: 'negative', stdin: '-3\n' }, { name: 'zero', stdin: '0\n' }],
  });
  assert.equal(result.current.compilation.exitCode, 0);
  assert.equal(result.current.tests.status, 'passed');
  assert.equal(result.comparison.status, 'matched_on_inputs');
  console.log(JSON.stringify({ projectId: p.projectId, nodes: p.graph.nodes.length, syntaxValid: true, tests: result.current.tests.status, comparison: result.comparison }, null, 2));
} finally { await fetch(`${base}/projects/${p.projectId}`, { method: 'DELETE' }); }
