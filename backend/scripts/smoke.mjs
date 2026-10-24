import assert from 'node:assert/strict';
const base = process.env.API_URL || 'http://127.0.0.1:3002/api';
const headers = { 'Content-Type': 'application/json', ...(process.env.BACKEND_API_KEY ? { 'X-Backend-Key': process.env.BACKEND_API_KEY } : {}) };
async function post(path, body) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const result = await response.json();
  assert.ok(response.ok, JSON.stringify(result)); return result;
}
const started = performance.now();
const code = 'public class Main { public static int f(int n) { if(n>0) return 1; return 0; } public static void main(String[] args) { System.out.println(f(3)); } }';
const p = await post('/projects/parse', { code, filename: 'Main.java' });
try {
  const condition = p.graph.nodes.find(n => n.data.astKind === 'IfStmt');
  assert.ok(condition);
  await post(`/projects/${p.projectId}/transform`, { revision: 0, operations: [{ type: 'updateCondition', nodeId: condition.id, code: 'n >= 1' }] });
  assert.equal((await post(`/projects/${p.projectId}/generate`, {})).syntaxValid, true);
  const analysis = await post(`/projects/${p.projectId}/analyze`, {});
  assert.equal(analysis.complexity.find(m => m.method === 'f').estimate, 'O(1)');
  const result = await post(`/projects/${p.projectId}/verify`, {
    revision: 1, mainClass: 'Main', inputs: [{ name: 'smoke', stdin: '', expectedStdout: '1\n' }],
    tests: [{ path: 'MainTest.java', content: 'import org.junit.jupiter.api.Test; import static org.junit.jupiter.api.Assertions.*; public class MainTest { @Test void positive(){ assertEquals(1,Main.f(3)); } }' }],
  });
  assert.equal(result.current.compilation.exitCode, 0, JSON.stringify(result.current.compilation));
  assert.equal(result.current.runs[0].passed, true);
  assert.equal(result.current.tests.status, 'passed');
  console.log(`Production smoke passed in ${(performance.now()-started).toFixed(0)} ms`);
} finally { await fetch(`${base}/projects/${p.projectId}`, { method: 'DELETE', headers }); }
