# JavaBlueprint backend

Fastify + TypeScript API, JavaParser CLI, AST/IR, React Flow graph and isolated javac/JUnit 5 runner. The current frontend uses this API; its old demo results are no longer used by the main workflow.

Production deployment, Vercel gateway and automatic tested releases: [deployment guide](../deploy/README.md).

## Local launch

Requirements: Node.js **22.12+**, JDK **21** (`java` and `javac` in PATH), Docker Engine with working CPU/memory/PID cgroups. Internet is needed for npm dependencies, Maven artifacts and the initial Docker image build. After setup, Java jobs run without network access.

From the repository root:

```bash
cd backend
npm ci
npm run setup
npm run runner:build
cp .env.example .env
npm run build
npm start
```

In another terminal:

```bash
cd frontend
npm ci
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to `http://127.0.0.1:3001`. For another API host set `VITE_API_URL` in the frontend environment, and set `CORS_ORIGIN` on the backend to the frontend origin. Both development mode (`npm run dev`) and production mode (`npm start`) read `.env`; exported terminal variables take precedence.

`npm run setup` downloads pinned JavaParser 3.26.4, Gson 2.12.1 and JUnit Platform Console Standalone 1.12.1 (JUnit Jupiter 5.12.1), checks Maven artifact checksums and compiles the trusted Java CLI. JARs and compiled classes are ignored by Git.

The API can parse/edit/analyze without Docker. Verification returns a real `503` when Docker or the runner image is unavailable. It has no host execution fallback.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST`, `PORT` | `127.0.0.1`, `3001` | API address |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma separated permitted browser origins |
| `JAVA_BIN` | `java` | JavaParser CLI runtime |
| `JAVAC_BIN` | `javac` | Engine build, used by setup |
| `DOCKER_BIN` | `docker` | Docker client |
| `DOCKER_HOST` | Docker default | Optional local/rootless daemon socket |
| `RUNNER_IMAGE` | `javablueprint-runner:local` | Prebuilt Java/JUnit image |
| `PROJECT_TTL_MS` | `7200000` | Inactivity TTL, two hours |
| `MAX_PROJECTS` | `50` | In-memory project capacity |

Keep the default loopback binding for the hackathon. Authentication and multi-user access control are not implemented. This service is intended for a trusted local workspace, not direct public hosting.

## API

All JSON routes reject unknown fields. Errors use `{ "error": { "code", "message", "details"? } }`. Parse failures use HTTP 422 and `errors: [{ file, line?, column?, message }]`.

| Method | Endpoint | Result |
| --- | --- | --- |
| GET | `/api/health` | API liveness; does not claim runner readiness |
| POST | `/api/projects/parse` | Parse source(s), create project, return files, structure, graph, revision |
| GET | `/api/projects/:id/graph` | Current project snapshot and React Flow nodes/edges |
| GET | `/api/projects/:id/ir` | Source-linked semantic IR and flow edges |
| PUT | `/api/projects/:id/sources` | Atomically replace sources after a successful parse |
| POST | `/api/projects/:id/transform` | Apply supported AST operations atomically |
| POST | `/api/projects/:id/transform/preview` | Validate a candidate without changing sources or revision |
| POST | `/api/projects/:id/generate` | Return Java sources after syntax revalidation |
| POST | `/api/projects/:id/analyze` | Diagnostics, structural metrics, conditional complexity bounds |
| POST | `/api/projects/:id/verify` | Isolated compilation, main inputs, JUnit and optional original comparison |
| DELETE | `/api/projects/:id` | Remove project, HTTP 204 |
| GET | `/api/projects/:id/ai-context` | Source/IR/analysis/latest verification for the AI module |
| POST | `/api/projects/:id/ai-proposals` | Verify candidate AST changes before committing them |

Generation and analysis accept `{}`. Graph/parse responses contain `projectId`, `revision`, `files`, `structure`, `containers`, `changes`, `graph`, `errors`. Structure includes packages, top-level types and discovered main class names. `containers` lists named classes, interfaces, records and enums, including nested types and types without methods, with stable IDs and filenames. `changes` identifies method roots created, replaced, copied or deleted by the latest request. Node `data.source` contains file, line and column ranges; `data.editable` lists supported semantic operations.

### Parse and transform

```json
{
  "files": [
    { "path": "Main.java", "content": "public class Main { public static int f(int x) { if (x > 0) return 1; return 0; } }" }
  ]
}
```

Alternatively use `{ "code": "...", "filename": "Main.java" }`. A missing filename defaults to `Main.java`; use the actual public class filename for compilation.

Select a node from the returned graph, then submit:

```json
{
  "revision": 0,
  "operations": [
    { "type": "updateCondition", "nodeId": "ID_FROM_GRAPH", "code": "x >= 1" }
  ]
}
```

| Operation | Supported target / `code` |
| --- | --- |
| `updateCondition` | if, while, do, for comparison; expression only |
| `updateExpression` | Expression statement, return, throw, switch selector, enhanced-for iterable; expression only |
| `updateVariable` | Field/local declaration initializer; use optional `variable` when several variables share a declaration |
| `replaceStatement` | Statement directly inside a block; complete Java statement |
| `addBlock` | Append inside method/constructor, or insert after statement directly in a block; complete statement |
| `deleteBlock` | Remove statement directly inside a block |
| `duplicateBlock` | Copy statement directly inside a block |
| `addMethod` | Named type ID from `containers`; one complete method declaration |
| `replaceMethod` | Method ID; one complete replacement declaration in the same type |
| `duplicateMethod` | Method ID; no code; generates an unused `nameCopy`, `nameCopy2`, etc. |
| `deleteMethod` | Method ID; no code; removes the method and its body |

No operation edits semantics through React Flow coordinates. Unsupported targets return 422. A failed batch leaves the whole project unchanged. Writes require the current `revision`; stale writes return 409. Generation reparses AST-produced sources; syntax success does not imply successful Java type checking. Run verification separately.

For a method, send `{"revision":0,"operations":[{"type":"addMethod","nodeId":"TYPE_ID","code":"public static int square(int value) { return value * value; }"}]}`. The preview route accepts the same body and returns a candidate snapshot with `preview: true`, `syntaxValid: true` and the unchanged revision. Preview does not reserve IDs or save a candidate; save reparses and validates the actual operation.

Method editing preserves the method ID; a signature-only change preserves unchanged body IDs. Copies get fresh IDs and omit `@Override`. Constructors, annotation members and methods in anonymous class bodies are outside these declaration operations. Checks cover modifier/body rules, duplicate parameter names, varargs placement and common erased signature collisions (generic arguments, type variables, arrays/varargs and explicit imports). This is not a full Java symbol resolver: external types, inherited contracts, return types and call sites are checked by javac through Run. Renaming/deleting a method does not rewrite callers.

For source editing use `{ "revision": 0, "files": [...] }` with `PUT /sources`. It preserves the original upload. IDs persist through supported AST edits, additions and deletions; arbitrary source rewrites rebuild structural identities. Ranges are refreshed after generated code is reparsed. Formatting is normalized by JavaParser; comments and imports are retained in the tested cases, without a byte-for-byte formatting guarantee.

### Verification

```json
{
  "revision": 1,
  "mainClass": "Main",
  "inputs": [
    { "name": "positive", "stdin": "3\n", "expectedStdout": "1\n" },
    { "name": "zero", "stdin": "0\n", "args": [] }
  ],
  "tests": [{ "path": "MainTest.java", "content": "...JUnit 5 source..." }],
  "compare": true
}
```

The same test sources, arguments and stdin are supplied to both versions. Tests may also be uploaded as part of the project. `mainClass` is optional for compile/JUnit-only checks. Supplying `inputs` requires `mainClass`; a main class without inputs runs once with empty stdin. Extra test paths must not duplicate project paths.

Each version returns `compilation`, `runs`, `tests`. Process results include stdout, stderr, exit code, wall-clock duration, timeout and output-limit flags. Durations include container startup and are not algorithm benchmarks. JUnit returns a suite result, discovered-test count in its name and the full console report, including individual failures. Coverage is not measured.

`comparison.status` is `matched_on_inputs`, `different`, `inconclusive` or `not_requested`. Matching means exact stdout, stderr and exit codes on the supplied cases only. Failed compilation, timeouts, failed expected outputs, failed JUnit or missing main input evidence make comparison inconclusive. `provenEquivalent` is **always false**.

## Execution isolation

The trusted JavaParser CLI processes source as data on the host; it never loads submitted classes. Submitted code is compiled and run only in Docker:

- Non-root UID/GID 10001, dropped capabilities, no-new-privileges, default Docker seccomp.
- No network; read-only root filesystem and compiled class volume during execution.
- Memory/swap ceiling 256 MiB, CPU quota one core, PID limit 96.
- Bounded 64 MiB temporary filesystem, disabled core dumps, bounded open files.
- Compilation timeout 25 seconds, each main input five seconds, JUnit 15 seconds, output at most 1 MiB per process.
- Fresh execution container for each input and JUnit invocation. Compilation uses `-proc:none`; submitted annotation processors are disabled.
- Containers, compilation volumes and host staging files are cleaned in `finally`, including timeouts and excessive output.

Docker capability checks reject daemons that do not report enforced CPU/memory/PID limits. Rootless Docker requires delegated cgroup controllers. If the Docker daemon becomes unreachable during cleanup, the API reports a cleanup failure; an administrator must remove leftover resources after daemon recovery. Normal cleanup is covered by integration tests.

The API `Dockerfile` packages Node + the trusted JDK parser + Docker CLI. The recommended hackathon setup runs the API on the host. Containerized verification additionally requires access to a Docker socket and a staging directory mounted at the **same absolute path** in the API container and Docker daemon host; set `TMPDIR` to that path. Socket permissions and staging mounts depend on your deployment and are not provisioned automatically.

## Tests and demo

```bash
cd backend
npm run typecheck
npm run build
npm test
RUN_DOCKER_TESTS=1 npm test
```

The default suite uses the real JavaParser and skips the five Docker integration tests. `RUN_DOCKER_TESTS=1` enables compilation, successful/failing JUnit, behavior differences, timeout/output/filesystem/network isolation, AI acceptance/rejection and the complete API cycle. It requires a built runner image. The parser suite also edits a generated 1000-line Java monolith.

`npm run test:ci` runs 26 focused backend groups, including AST edits, layout and complexity counterexamples. After installing frontend dependencies, `npm run test:frontend` runs one store/API regression group. The supplied warehouse stress files were also checked with real javac/JUnit, behavior-preserving edits and failing mutations; see the [audit and evidence](../docs/audits/2026-10-25/README.md).

A second, authored [Mission Control monolith](examples/mission-control/README.md) has 1,566 lines, 100 explicit method/constructor scopes and 16 JUnit tests with independent algorithm oracles. Run `npm run stress:mission` for its manual parser/isolated Java/mutation audit, or `npm run stress:mission:browser` with local development servers running. Both accept `--output /path/to/evidence`; the browser command also accepts `--url https://your-site`. These large checks are excluded from per-push CI. Results and remaining limits are in its [audit](../docs/audits/mission-control-2026-10-25/README.md).

Browser end-to-end test (requires frontend dependencies, Docker and runner image):

```bash
npx playwright install chromium
npm run test:browser
```

You can use an installed browser instead with `CHROME_PATH=/path/to/chrome npm run test:browser`. Playwright starts backend/frontend development servers automatically; it imports real sources/tests, edits graph blocks, runs Java and checks the visible JUnit and console results. The method workflow also creates a method in an empty class, previews without saving, edits its body, handles a conflicting signature, copies/deletes it and verifies it with javac and JUnit. Use `E2E_BASE_URL=https://your-site` to exercise a deployed frontend and gateway.

The five browser scenarios also cover file/method navigation, case edits affecting real execution, and invalid source followed by recovery. They run manually, outside the per-push CI suite.

With the API already running:

```bash
npm run demo
```

The demo uses `examples/Main.java` and `MainTest.java`, changes `value > 0` to `value >= 1`, generates Java, compiles, runs three JUnit tests and compares three identical inputs. It asserts real outcomes and removes its temporary project afterward. In the UI, select both example files in the import dialog, double-click the condition to edit it, and press Run. Stdin can be edited in the test panel.

Validation includes the quick API/complexity/deployment identity suite, a gateway check, the Playwright workflow, and a real HTTPS API/javac/JUnit smoke run on the VPS. Backend/frontend TypeScript, builds and frontend lint pass. The broader Docker isolation suite is available separately. The Java runner image was built and exercised. Building the separate API image could not be validated because this Docker daemon could not fetch its Node base image; host API execution was validated instead.

## Scope and limits

- Java 21 syntax is parsed by JavaParser. Classes, interfaces, fields, constructors, methods, primitives, arrays, standard Java I/O, strings and collections are preserved. JDK 21 compiles the code. Record, enum, generics, lambdas and streams are accepted; not every construct is individually editable in the graph.
- Graph flow covers if/else, switch statements, for/foreach/while/do, lexical targets of labeled/unlabeled break/continue, returns and throws. Dagre lays out each method/constructor separately; the frontend scopes the graph by file and method. Completion-sensitive CFG routes normal/return/throw/break/continue through separate finally contexts. Resources initialize left to right and close right to left; primary exceptions, suppression and close failures have explicit routes. Known exception types select the first compatible catch; unknown implicit exception types branch conservatively. Lambda and switch-expression bodies stay in the AST but are not expanded as misleading disconnected statements. Warnings expose these limits. This is not a complete interprocedural Java CFG.
- Long methods, exact duplicate operations, nested loops and calls in loop bounds are heuristic diagnostics. The AST complexity model composes sequential costs, branches, constant/linear/logarithmic `for` loops, recognized `while`, array/standard collection traversal, primitive array allocation, selected JDK operations and unambiguous local method calls. It retains independent input sizes, such as `O(n * m)` and `O(n + m)`, and emits assumptions plus line-linked evidence. The model also composes project-local constructors, generic fields and calls, return sizes, stream callbacks, string growth, recognized recurrences, binary search and guarded worklists. Callback/conversion costs and result sizes may remain explicit symbolic contracts. Library I/O is charged by data volume, excluding external waiting. Unknown calls, unrecognized recursion, mutated bounds and unsafe counter updates remain unknown. All recognized results are conditional upper bounds, not formal proofs. No invented speedup, maintainability score or coverage.
- Projects are in memory and disappear on restart; inactive entries expire. Max 50 projects, 100 source files and 2 MiB source per project. Paths are relative ASCII `.java` paths; traversal/duplicates are rejected. At most four parser jobs and two verification jobs run concurrently; excess load returns 429.
- Only JDK libraries and provided JUnit are available to submitted projects. Maven/Gradle dependency resolution, ZIP uploads, persistent storage, authentication, full behavioral proofs and advanced optimization are outside this implementation.
- AI chat uses a server-configured OpenAI-compatible gateway (`AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`). The deployed gateway setup is documented in the [deployment guide](../deploy/README.md#ai-gateway). Model proposals still pass the compilation, JUnit and input-comparison gate described in [AI_CONTRACT.md](AI_CONTRACT.md).

Reference APIs: [JavaParser](https://github.com/javaparser/javaparser), [Fastify validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), [Docker resource controls](https://docs.docker.com/engine/containers/run/).

The Big O and finally upgrade has a separate [audit](../docs/audits/analysis-upgrade-2026-10-25/README.md). Run `npm run check:analysis` manually for 10 real JUnit completion/resource oracles in Docker. Large MissionControl and warehouse checks stay outside per-push CI.
