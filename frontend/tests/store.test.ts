import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../backend/src/app.js';

test('editor scopes files and methods, preserves deliberate drags, inserts unique variables and protects AST metrics from AI', async () => {
  // Import through a URL so the backend tsc project does not absorb frontend sources.
  const { useProjectStore: store } = await import(new URL('../src/store/useProjectStore.ts', import.meta.url).href);
  const app = buildApp();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const headers = { 'content-type': 'application/json', ...(process.env.BACKEND_API_KEY ? { 'x-backend-key': process.env.BACKEND_API_KEY } : {}) };
    const response = await app.inject({ method: init?.method as 'POST' | 'GET' ?? 'GET', url, headers, ...(typeof init?.body === 'string' ? { payload: init.body } : {}) });
    return new Response(response.statusCode === 204 ? null : response.body, { status: response.statusCode });
  }) as typeof fetch;
  try {
    await store.getState().importJavaFiles([
      { path: 'Main.java', content: 'class Main { public static void main(String[] args) {} static int calculate(int value) { return value * 2; } }' },
      { path: 'Other.java', content: 'class Other { void work() {} }' },
    ], true);
    assert.equal(store.getState().error, null);
    const calculate = store.getState().nodes.find((n: any) => n.data.title === 'calculate');
    store.getState().setActiveMethodId(calculate.id);
    const dragged = { x: 1234, y: 5678 };
    store.getState().onNodesChange([{ type: 'position', id: calculate.id, position: dragged, dragging: false }]);
    await store.getState().addNode('variable');
    assert.equal(store.getState().error, null);
    assert.ok(store.getState().sourceFiles[0].content.includes('int value2 = 0;'));
    assert.ok(store.getState().sourceFiles[0].content.indexOf('int value2') < store.getState().sourceFiles[0].content.indexOf('return value'));
    assert.deepEqual(store.getState().nodes.find((n: any) => n.id === calculate.id).position, dragged);
    store.getState().resetGraphLayout();
    assert.notDeepEqual(store.getState().nodes.find((n: any) => n.id === calculate.id).position, dragged);
    store.getState().selectFile('Other.java');
    assert.equal(store.getState().nodes.find((n: any) => n.id === store.getState().activeMethodId).data.title, 'work');
    const metrics = store.getState().metrics, complexity = store.getState().complexity;
    store.getState().applyAIAnalysis({ metrics: { linesOfCode: 99999 }, complexity: { current: 'O(1)', optimized: 'O(1)', speedup: '100x', explanation: 'unverified' }, issues: [{ id: 'one', title: 'Suggested issue', level: 'low', description: 'Review', file: 'Main.java', line: 1 }], recommendations: [] });
    assert.deepEqual(store.getState().metrics, metrics);
    assert.deepEqual(store.getState().complexity, complexity);
    assert.ok(store.getState().issues.some((i: any) => i.id === 'ai:one'));
  } finally { globalThis.fetch = realFetch; await app.close(); }
});
