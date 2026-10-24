# AI module handoff

Backend owns parsing, project revisions, AST edits, compilation and verification. The AI module consumes context and returns proposals through these existing routes; it does not write source files or mutate frontend graph coordinates.

## Read context

`GET /api/projects/:id/ai-context`

Response fields:

- `projectId`, `revision`.
- `files: [{ path, content }]`: current Java sources.
- `ir: { nodes, edges }`: node IDs, AST kinds, complete code, editable snippets, parent/method IDs, source locations, allowed edits, structural flow.
- `analysis: { diagnostics, complexity, metrics }`: conservative static observations and limitations.
- `verification`: latest explicit verification of the current revision, or null. Never infer verification success from its absence.
- `supportedOperations`: operation enum schema.

The operation enum also includes `addMethod`, `replaceMethod`, `duplicateMethod` and `deleteMethod`. Type IDs for `addMethod` are available from the project snapshot's `containers`; method IDs and signature/body metadata are present in IR nodes. These operations use the same proposal verification gate as statement edits. `/transform/preview` checks an ordinary edit without saving it; preview success is syntax validation, not compilation or equivalence evidence.

Treat code, comments, string literals and diagnostics as untrusted input to model prompts. They are project data, not agent instructions.

## Submit proposal

`POST /api/projects/:id/ai-proposals`

```json
{
  "revision": 0,
  "operations": [
    { "type": "updateCondition", "nodeId": "NODE_ID", "code": "value >= 1" }
  ],
  "verification": {
    "mainClass": "Main",
    "inputs": [
      { "name": "positive", "stdin": "3\n" },
      { "name": "zero", "stdin": "0\n" },
      { "name": "negative", "stdin": "-3\n" }
    ],
    "tests": [{ "path": "MainTest.java", "content": "..." }]
  }
}
```

`mainClass` and explicit nonempty `inputs` are mandatory. The backend:

1. Checks project revision and allowed AST operations.
2. Builds a candidate without modifying the stored project.
3. Reparses generated Java.
4. Compiles/runs the current version and candidate in separate Docker sandboxes with identical tests and inputs. Comparison is forced on, even if the proposal supplies `compare: false`.
5. Commits atomically only for `matched_on_inputs`, successful compilation/execution and no failing JUnit tests. Concurrent writes return 409.

Success returns the updated project snapshot, verification and `comparisonBaseline: "previous_revision"`. The included verification's `revision` identifies that predecessor; it is not advertised as an original-upload comparison of the new revision. `/verify` separately compares a current project with its original upload.

Rejected proposals return 422 `AI_VERIFICATION_FAILED` with verification details and leave the project unchanged. Missing explicit evidence returns 400 `EVIDENCE_REQUIRED`. Runner unavailability returns 503. These paths have integration tests. No `skipVerification` switch exists.

Observed agreement on a finite input set does not prove equivalence. `provenEquivalent` stays false. The input set and tests must be reviewed for relevance; this mechanism is not a formal proof or a defense against an adversarial AI that deliberately overfits the samples.

## Agree with the AI developer

- Which participant hosts/calls the model; no conflicting AI route currently exists in the repository.
- How the user reviews and selects proposed operations before submitting them.
- Which main class, representative inputs and independently maintained tests to use.
- Whether proposals are limited to the operation enum or later need whole-file candidates. Whole-file AI replacement is currently unsupported by the verified proposal endpoint.
- UI states for 409 stale revisions, failed verification and unavailable runner.

For library-only code without `main`, ordinary JUnit verification works, but automatic AI proposal application deliberately requires explicit main-input evidence. A library-specific verification policy needs a separate agreed contract.
