import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Type, type Static } from '@sinclair/typebox';
import { JavaParserEngine, type JavaEngine } from './adapters/java-engine.js';
import { DockerRunner, type Runner } from './adapters/docker-runner.js';
import { ProjectStore, validateFiles, type Project } from './services/projects.js';
import { graph } from './services/graph.js';
import { analyze } from './services/analyzer.js';
import { ApiError } from './services/errors.js';
import type { VerifyRequest } from './types/index.js';
import { timingSafeEqual } from 'node:crypto';
import { processAIChatRequest, streamAIChatRequest } from './services/aiService.js';

const Strict = { additionalProperties: false };
const File = Type.Object({ path: Type.String({ minLength: 6, maxLength: 240 }), content: Type.String({ maxLength: 2097152 }) }, Strict);
const Files = Type.Array(File, { minItems: 1, maxItems: 100 });
const Revision = Type.Integer({ minimum: 0 });
const Parse = Type.Union([
  Type.Object({ files: Files }, Strict),
  Type.Object({ code: Type.String({ maxLength: 2097152 }), filename: Type.Optional(Type.String({ maxLength: 240 })) }, Strict),
]);
const Operation = Type.Object({
  type: Type.Union([Type.Literal('updateCondition'), Type.Literal('updateExpression'), Type.Literal('updateVariable'), Type.Literal('replaceStatement'), Type.Literal('addBlock'), Type.Literal('deleteBlock'), Type.Literal('duplicateBlock')]),
  nodeId: Type.String({ minLength: 1, maxLength: 80 }),
  code: Type.Optional(Type.String({ minLength: 1, maxLength: 100000 })), variable: Type.Optional(Type.String({ maxLength: 100 })),
}, Strict);
const TransformBody = Type.Object({ revision: Revision, operations: Type.Array(Operation, { minItems: 1, maxItems: 50 }) }, Strict);
const Verify = Type.Object({
  revision: Type.Optional(Revision),
  mainClass: Type.Optional(Type.String({ pattern: '^[A-Za-z_$][A-Za-z0-9_$]*(\\.[A-Za-z_$][A-Za-z0-9_$]*)*$', maxLength: 240 })),
  inputs: Type.Optional(Type.Array(Type.Object({
    name: Type.String({ minLength: 1, maxLength: 100 }), stdin: Type.String({ maxLength: 65536 }),
    args: Type.Optional(Type.Array(Type.String({ maxLength: 1000 }), { maxItems: 20 })),
    expectedStdout: Type.Optional(Type.String({ maxLength: 65536 })),
  }, Strict), { minItems: 1, maxItems: 10 })),
  tests: Type.Optional(Type.Array(File, { maxItems: 50 })), compare: Type.Optional(Type.Boolean()),
}, Strict);
const Params = Type.Object({ id: Type.String({ pattern: '^[0-9a-f-]{36}$' }) }, Strict);

export function buildApp(options: { engine?: JavaEngine; runner?: Runner; store?: ProjectStore; logger?: boolean } = {}) {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 4 * 1024 * 1024, ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  const engine = options.engine ?? new JavaParserEngine();
  const runner = options.runner ?? new DockerRunner();
  const store = options.store ?? new ProjectStore(Number(process.env.PROJECT_TTL_MS || 7200000), Number(process.env.MAX_PROJECTS || 50));
  app.register(cors, { origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',') });
  const apiKey = process.env.BACKEND_API_KEY;
  app.addHook('onRequest', async (request) => {
    if (!apiKey || request.url.split('?')[0] === '/api/health') return;
    const supplied = request.headers['x-backend-key'];
    const bytes = Buffer.from(typeof supplied === 'string' ? supplied : '');
    const expected = Buffer.from(apiKey);
    if (bytes.length !== expected.length || !timingSafeEqual(bytes, expected)) throw new ApiError(401, 'UNAUTHORIZED', 'Use the application API gateway');
  });
  const cleanup = setInterval(() => store.clean(), 60000);
  cleanup.unref();
  app.addHook('onClose', async () => { clearInterval(cleanup); });
  let parsing = 0;
  const processJava: JavaEngine['process'] = async (...args) => {
    if (parsing >= Number(process.env.MAX_PARSER_JOBS || 4)) throw new ApiError(429, 'PARSER_BUSY', 'Java parser is busy; try again shortly');
    parsing++;
    try { return await engine.process(...args); } finally { parsing--; }
  };
  const snapshot = (p: Project) => ({ projectId: p.id, revision: p.revision, files: p.result.files, structure: p.result.structure, graph: graph(p.result), errors: p.result.errors });
  const revisionCheck = (p: Project, revision?: number) => {
    if (revision !== undefined && revision !== p.revision) throw new ApiError(409, 'REVISION_CONFLICT', 'Project changed; reload before editing');
  };
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
    const err = error as { validation?: unknown; statusCode?: number; message?: string };
    if (err.validation) return reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: err.message } });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: { code: 'INVALID_REQUEST', message: err.message } });
    request.log.error(error);
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } });
  });
  app.get('/api/health', async () => ({ status: 'ok', version: process.env.GIT_SHA || 'development', java: 'JavaParser CLI', execution: 'docker-only' }));
  app.post<{ Body: Static<typeof Parse> }>('/api/projects/parse', { schema: { body: Parse } }, async (request, reply) => {
    const files = 'files' in request.body ? request.body.files : [{ path: request.body.filename ?? 'Main.java', content: request.body.code }];
    validateFiles(files);
    const result = await processJava(files);
    if (result.errors.length) return reply.code(422).send({ projectId: null, errors: result.errors, graph: graph(result) });
    return reply.code(201).send(snapshot(store.create(result)));
  });
  app.get<{ Params: Static<typeof Params> }>('/api/projects/:id/graph', { schema: { params: Params } }, async request => snapshot(store.get(request.params.id)));
  app.get<{ Params: Static<typeof Params> }>('/api/projects/:id/ir', { schema: { params: Params } }, async request => {
    const p = store.get(request.params.id);
    return { projectId: p.id, revision: p.revision, nodes: p.result.nodes, edges: p.result.edges, warnings: p.result.warnings };
  });
  app.put<{ Params: Static<typeof Params>; Body: { revision: number; files: Static<typeof Files> } }>('/api/projects/:id/sources', {
    schema: { params: Params, body: Type.Object({ revision: Revision, files: Files }, Strict) },
  }, async (request, reply) => {
    const p = store.get(request.params.id);
    revisionCheck(p, request.body.revision);
    validateFiles(request.body.files);
    const result = await processJava(request.body.files);
    if (result.errors.length) return reply.code(422).send({ errors: result.errors });
    return snapshot(store.update(p.id, request.body.revision, result));
  });
  app.post<{ Params: Static<typeof Params>; Body: Static<typeof TransformBody> }>('/api/projects/:id/transform', { schema: { params: Params, body: TransformBody } }, async request => {
    const p = store.get(request.params.id);
    revisionCheck(p, request.body.revision);
    for (const op of request.body.operations) if (!['deleteBlock', 'duplicateBlock'].includes(op.type) && !op.code) throw new ApiError(400, 'CODE_REQUIRED', `${op.type} requires code`);
    const result = await processJava(p.result.files, p.result.identities, request.body.operations);
    if (result.errors.length) throw new ApiError(422, 'INVALID_JAVA', 'Transformation produced invalid Java', result.errors);
    validateFiles(result.files);
    return snapshot(store.update(p.id, request.body.revision, result));
  });
  app.post<{ Params: Static<typeof Params> }>('/api/projects/:id/generate', { schema: { params: Params, body: Type.Object({}, Strict) } }, async request => {
    const p = store.get(request.params.id);
    const revision = p.revision, result = p.result;
    const check = await processJava(result.files, result.identities);
    if (check.errors.length) throw new ApiError(422, 'INVALID_JAVA', 'Generated Java did not reparse', check.errors);
    return { projectId: p.id, revision, files: result.files, syntaxValid: true };
  });
  app.post<{ Params: Static<typeof Params> }>('/api/projects/:id/analyze', { schema: { params: Params, body: Type.Object({}, Strict) } }, async request => {
    const p = store.get(request.params.id);
    return { projectId: p.id, revision: p.revision, ...analyze(p.result) };
  });
  app.post<{ Params: Static<typeof Params>; Body: Static<typeof Verify> }>('/api/projects/:id/verify', { schema: { params: Params, body: Verify } }, async request => {
    const p = store.get(request.params.id);
    revisionCheck(p, request.body.revision);
    if (request.body.tests?.length) validateFiles(request.body.tests);
    const revision = p.revision;
    const result = await runner.verify(p.original, p.result.files, request.body, revision);
    if (store.get(p.id).revision === revision) p.verification = result;
    return result;
  });
  app.delete<{ Params: Static<typeof Params> }>('/api/projects/:id', { schema: { params: Params } }, async (request, reply) => {
    store.delete(request.params.id); return reply.code(204).send();
  });
  // AI has no separate code path into mutable state. A candidate is verified first,
  // and committed only when supplied input cases match and supplied tests pass.
  app.get<{ Params: Static<typeof Params> }>('/api/projects/:id/ai-context', { schema: { params: Params } }, async request => {
    const p = store.get(request.params.id);
    return { projectId: p.id, revision: p.revision, files: p.result.files, ir: { nodes: p.result.nodes, edges: p.result.edges }, analysis: analyze(p.result), verification: p.verification ?? null, supportedOperations: Operation.properties.type };
  });
  const Proposal = Type.Object({ revision: Revision, operations: Type.Array(Operation, { minItems: 1, maxItems: 50 }), verification: Verify }, Strict);
  app.post<{ Params: Static<typeof Params>; Body: Static<typeof Proposal> }>('/api/projects/:id/ai-proposals', { schema: { params: Params, body: Proposal } }, async request => {
    const p = store.get(request.params.id);
    revisionCheck(p, request.body.revision);
    if (!request.body.verification.mainClass || !request.body.verification.inputs?.length) throw new ApiError(400, 'EVIDENCE_REQUIRED', 'AI proposals require mainClass and explicit comparison inputs');
    const candidate = await processJava(p.result.files, p.result.identities, request.body.operations);
    if (candidate.errors.length) throw new ApiError(422, 'INVALID_JAVA', 'AI proposal is not valid Java', candidate.errors);
    validateFiles(candidate.files);
    if (request.body.verification.tests?.length) validateFiles(request.body.verification.tests);
    const verifyRequest: VerifyRequest = { ...request.body.verification, compare: true };
    const verification = await runner.verify(p.result.files, candidate.files, verifyRequest, p.revision);
    if (verification.comparison.status !== 'matched_on_inputs') throw new ApiError(422, 'AI_VERIFICATION_FAILED', 'AI proposal did not preserve observed behavior on supplied inputs', verification);
    const updated = store.update(p.id, request.body.revision, candidate);
    // Candidate verification compares against the immediate predecessor, not initial upload.
    return { ...snapshot(updated), verification, comparisonBaseline: 'previous_revision' };
  });
  const AIChatBody = Type.Object({
    message: Type.String({ minLength: 1, maxLength: 50000 }),
    config: Type.Optional(Type.Object({
      provider: Type.Optional(Type.Union([Type.Literal('gemini'), Type.Literal('openai'), Type.Literal('anthropic'), Type.Literal('ollama'), Type.Literal('openrouter'), Type.Literal('omniroute')])),
      apiKey: Type.Optional(Type.String({ maxLength: 500 })),
      model: Type.Optional(Type.String({ maxLength: 100 })),
      baseUrl: Type.Optional(Type.String({ maxLength: 500 })),
    }, Strict)),
  }, Strict);
  app.post<{ Params: Static<typeof Params>; Body: Static<typeof AIChatBody> }>('/api/projects/:id/ai-chat', {
    schema: { params: Params, body: AIChatBody },
  }, async request => {
    const p = store.get(request.params.id);
    const aiContext = {
      projectId: p.id,
      revision: p.revision,
      files: p.result.files,
      ir: { nodes: p.result.nodes, edges: p.result.edges },
      analysis: analyze(p.result),
      verification: p.verification ?? null,
    };
    return await processAIChatRequest(aiContext, request.body.message, request.body.config);
  });
  app.post<{ Params: Static<typeof Params>; Body: Static<typeof AIChatBody> }>('/api/projects/:id/ai-chat-stream', {
    schema: { params: Params, body: AIChatBody },
  }, async (request, reply) => {
    const p = store.get(request.params.id);
    const aiContext = {
      projectId: p.id,
      revision: p.revision,
      files: p.result.files,
      ir: { nodes: p.result.nodes, edges: p.result.edges },
      analysis: analyze(p.result),
      verification: p.verification ?? null,
    };

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    try {
      const result = await streamAIChatRequest(
        aiContext,
        request.body.message,
        (delta) => {
          reply.raw.write(`event: chunk\ndata: ${JSON.stringify({ text: delta })}\n\n`);
        },
        request.body.config
      );

      reply.raw.write(`event: done\ndata: ${JSON.stringify({
        proposal: result.proposal,
        parsedAnalysis: result.parsedAnalysis,
        fullReply: result.fullReply,
      })}\n\n`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`);
    } finally {
      reply.raw.end();
    }
  });
  return app;
}
