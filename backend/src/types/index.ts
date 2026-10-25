export interface SourceFile { path: string; content: string }
export interface SourceRef { file: string; startLine: number; endLine: number; startColumn: number; endColumn: number }
export interface Identity { file: string; astPath: string; id: string }
export interface IRNode {
  id: string; astPath: string; astKind: string; kind: 'method' | 'variable' | 'condition' | 'loop' | 'operation' | 'return';
  title: string; code: string; snippet: string; source: SourceRef; parentId?: string;
  depth: number; loopDepth: number; methodId?: string; editable: string[];
  containerId?: string; method?: { signature: string; body: string; hasBody: boolean };
  displayCode?: string; warning?: string;
  originId?: string; synthetic?: boolean; context?: string; completion?: string; resource?: string;
  complexity?: { estimate: string; status: 'estimated' | 'unknown'; kind: 'upper_bound'; confidence: string; assumptions: string[]; limitations: string[]; explanation: string; evidence: { line: number; nodeId: string; estimate: string; rule: string }[] };
}
export interface IREdge { source: string; target: string; label?: string; kind: string }
export interface ParseError { file: string; message: string; line?: number; column?: number }
export interface EngineResult {
  files: SourceFile[]; nodes: IRNode[]; edges: IREdge[]; identities: Identity[];
  errors: ParseError[]; warnings: string[];
  structure: { path: string; packageName: string; types: string[]; mainClasses: string[] }[];
  containers?: { id: string; name: string; file: string; kind: string; canAddMethods: boolean; isAbstract: boolean; methodNames: string[] }[];
  changes?: { operation: string; nodeId: string; containerId: string }[];
}
export type Transform = {
  type: 'updateCondition' | 'updateExpression' | 'updateVariable' | 'replaceStatement' | 'addBlock' | 'deleteBlock' | 'duplicateBlock' | 'addMethod' | 'replaceMethod' | 'deleteMethod' | 'duplicateMethod';
  nodeId: string; code?: string; variable?: string;
};
export interface ProcessResult {
  stdout: string; stderr: string; exitCode: number | null; durationMs: number;
  timedOut: boolean; outputLimitExceeded: boolean;
}
export interface InputCase { name: string; stdin: string; args?: string[]; expectedStdout?: string }
export interface VerifyRequest { mainClass?: string; inputs?: InputCase[]; tests?: SourceFile[]; compare?: boolean }
export interface TestCase { id: string; name: string; status: 'success' | 'failure' | 'idle'; durationMs: number; details?: string }
export interface VersionResult {
  compilation: ProcessResult; runs: (ProcessResult & { name: string; passed: boolean | null })[];
  tests: { status: 'passed' | 'failed' | 'not_run'; cases: TestCase[]; execution?: ProcessResult; report?: string };
}
export interface Verification {
  revision: number; current: VersionResult; original?: VersionResult;
  comparison: { status: 'matched_on_inputs' | 'different' | 'inconclusive' | 'not_requested'; checkedInputs: number; provenEquivalent: false; explanation: string };
}
