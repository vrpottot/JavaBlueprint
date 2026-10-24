import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { JavaParserEngine } from '../src/adapters/java-engine.js';
import { analyze } from '../src/services/analyzer.js';
import { buildPromptContext } from '../src/services/ai-prompt-context.js';
import { processAIChatRequest } from '../src/services/aiService.js';

test('AI receives bounded, source-linked context for named methods in a large project', async () => {
  const filler = Array.from({ length: 70 }, (_, i) => `int unused${i}() { /* ${'unrelated '.repeat(100)} */ return ${i}; }`).join('\n');
  const parsed = await new JavaParserEngine().process([{ path: 'Main.java', content: `class Main {
    ${filler}
    int linearSum(int[] a) { int sum = 0; for (int value : a) sum += value; return sum; }
    int countInversions(int[] a) { int inversions = 0; for(int i=0;i<a.length;i++) for(int j=i+1;j<a.length;j++) if(a[i]>a[j]) inversions++; return inversions; }
  }` }]);
  const context = { projectId: 'test', revision: 0, files: parsed.files, ir: { nodes: parsed.nodes, edges: parsed.edges }, analysis: analyze(parsed), verification: null };
  const message = 'Для Main.linearSum и countInversions объясни Big O.';
  const bounded = buildPromptContext(context, message, 10000);
  assert.ok(bounded.analysis.length + bounded.nodes.length + bounded.sources.length <= 10000);
  assert.match(bounded.scope, /Partial project context/);
  assert.match(bounded.sources, /return sum;/);
  assert.match(bounded.sources, /return inversions;/);
  assert.ok(!bounded.sources.includes('unrelated'));
  for (const name of ['linearSum', 'countInversions']) {
    const method = parsed.nodes.find(node => node.title === name)!;
    assert.ok(bounded.nodes.includes(method.id));
    assert.ok(bounded.analysis.includes(method.id));
  }
  const tiny = buildPromptContext(context, 'unused0', 1000);
  assert.ok(tiny.analysis.length + tiny.nodes.length + tiny.sources.length <= 1000);
  assert.match(tiny.sources, /truncated/);
  const small = { ...context, files: [{ path: 'Empty.java', content: 'class Empty {}' }], ir: { nodes: [], edges: [] } };
  assert.ok(buildPromptContext(small, 'review', 10000).sources.includes('class Empty {}'));

  let captured: { model: string; messages: { content: string }[] } | undefined;
  const upstream = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    captured = JSON.parse(Buffer.concat(chunks).toString());
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const port = (upstream.address() as { port: number }).port;
  const before = { key: process.env.AI_API_KEY, base: process.env.AI_BASE_URL, model: process.env.AI_MODEL };
  try {
    process.env.AI_API_KEY = 'test-only';
    process.env.AI_BASE_URL = `http://127.0.0.1:${port}/v1`;
    process.env.AI_MODEL = 'ddgw/claude-haiku-4-5';
    const reply = await processAIChatRequest(context, message);
    assert.equal(reply.reply, 'OK');
    assert.equal(captured?.model, 'ddgw/claude-haiku-4-5');
    const prompt = captured!.messages.map(item => item.content).join('\n');
    assert.ok(prompt.length < 16000, `Unexpected oversized prompt: ${prompt.length}`);
    assert.ok(prompt.includes('return inversions;'));
    assert.ok(!prompt.includes('unrelated'));
    assert.ok(prompt.includes('UNTRUSTED project data'));
  } finally {
    for (const [name, value] of Object.entries({ AI_API_KEY: before.key, AI_BASE_URL: before.base, AI_MODEL: before.model })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await new Promise<void>(resolve => upstream.close(() => resolve()));
  }
});
