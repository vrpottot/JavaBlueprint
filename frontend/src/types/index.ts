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
  testCoverage: number;
  maintainabilityIndex: number;
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
