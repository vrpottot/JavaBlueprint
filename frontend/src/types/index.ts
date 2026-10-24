export type BlockType =
  | 'method'
  | 'variable'
  | 'condition'
  | 'loop'
  | 'operation'
  | 'return';

export interface VisualBlockData {
  title: string;
  codeSnippet: string;
  blockType: BlockType;
  description?: string;
  badge?: string;
  error?: string;
  warning?: string;
  line?: number;
  isHighlighted?: boolean;
  inputs?: Array<{ id: string; label: string }>;
  outputs?: Array<{ id: string; label: string }>;
  [key: string]: unknown;
}

export interface FileItem {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileItem[];
  hasIssues?: boolean;
  issueCount?: number;
}

export type IssueSeverity = 'high' | 'medium' | 'low';

export interface CodeIssue {
  id: string;
  title: string;
  level: IssueSeverity;
  file: string;
  line: number;
  description: string;
  nodeId?: string;
  resolved?: boolean;
}

export interface CodeRecommendation {
  id: string;
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  tag: string;
}

export interface CodeMetrics {
  cyclomaticComplexity: number;
  linesOfCode: number;
  nestingDepth: number;
  testCoverage: number | null;
  maintainabilityIndex: number | null;
}

export interface ComplexityEstimate {
  current: string;
  optimized: string;
  speedup: string;
  explanation: string;
}

export type ConsoleLogType = 'info' | 'success' | 'warn' | 'error';

export interface ConsoleLog {
  id: string;
  timestamp: string;
  type: ConsoleLogType;
  message: string;
}

export type TestStatus = 'idle' | 'running' | 'success' | 'failure';

export interface TestCase {
  id: string;
  name: string;
  status: TestStatus;
  durationMs: number;
  details?: string;
}

export interface BlockPaletteItem {
  type: BlockType;
  name: string;
  description: string;
  defaultCode: string;
  color: string;
}

export interface AIProposalOperation {
  type: 'updateCondition' | 'updateExpression' | 'updateVariable' | 'replaceStatement' | 'addBlock' | 'deleteBlock' | 'duplicateBlock';
  nodeId: string;
  code?: string;
}

export interface AIProposalVerification {
  mainClass: string;
  inputs: { name: string; stdin: string; args?: string[]; expectedStdout?: string }[];
  tests?: { path: string; content: string }[];
}

export interface AIProposal {
  revision: number;
  operations: AIProposalOperation[];
  verification: AIProposalVerification;
}

export interface AIChatAnalysis {
  issues?: CodeIssue[];
  recommendations?: CodeRecommendation[];
  metrics?: CodeMetrics;
  complexity?: ComplexityEstimate;
  optimizedCode?: string;
  summary?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: string;
  text: string;
  analysis?: AIChatAnalysis;
  proposal?: AIProposal;
  proposalStatus?: 'idle' | 'verifying' | 'verified' | 'failed';
  proposalVerificationResult?: unknown;
  isStreaming?: boolean;
}

