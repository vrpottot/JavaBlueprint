import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import handler from '../../frontend/api/[...path].ts';
import { buildApp } from '../src/app.ts';
process.env.BACKEND_API_KEY = 'gateway-test-only';
const app = buildApp();
await app.listen({ host: '127.0.0.1', port: 0 });
process.env.BACKEND_URL = app.listeningOrigin;
const gateway = createServer((request, response) => { void handler(request, response); });
await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${gateway.address().port}`;
try {
  const response = await fetch(`${base}/api/projects/parse`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Backend-Key': 'untrusted-client-value' },
    body: JSON.stringify({ filename: 'A.java', code: 'class A { int f(int n) { return n + 1; } }' }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  const project = await response.json();
  const analysis = await fetch(`${base}/api/projects/${project.projectId}/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(analysis.status, 200);
  assert.equal((await analysis.json()).complexity[0].estimate, 'O(1)');
  assert.equal((await fetch(`${base}/api/invalid`)).status, 404);
  assert.equal((await fetch(`${base}/api/projects/${project.projectId}`, { method: 'DELETE' })).status, 204);
  console.log('Gateway smoke passed: protected parse, analysis, routing and empty-body DELETE');
} finally { await app.close(); await new Promise(resolve => gateway.close(resolve)); }
