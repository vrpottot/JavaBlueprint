import type { Node, Edge } from '@xyflow/react';
import type { VisualBlockData, CodeIssue, CodeMetrics, TestCase } from '../types';
export interface SourceFile { path: string; content: string }
export interface ProjectSnapshot {
  projectId: string; revision: number; files: SourceFile[];
  structure: { path: string; mainClasses: string[] }[];
  graph: { nodes: Node<VisualBlockData>[]; edges: Edge[]; warnings: string[] };
}
export interface Analysis {
  diagnostics: (Omit<CodeIssue, 'level'> & { severity: 'high' | 'medium' | 'low'; recommendation: string })[];
  complexity: { estimate: string; structuralBound: string; explanation: string }[];
  metrics: CodeMetrics;
}
export interface Execution { stdout: string; stderr: string; exitCode: number | null; durationMs: number; timedOut: boolean; outputLimitExceeded: boolean }
export interface VersionResult { compilation: Execution; runs: (Execution & { name: string; passed: boolean | null })[]; tests: { status: string; cases: TestCase[] } }
export interface Verification { revision: number; current: VersionResult; original?: VersionResult; comparison: { status: string; explanation: string; provenEquivalent: false } }
const base = import.meta.env.VITE_API_URL || '/api';
export async function api<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const response = await fetch(`${base}${path}`, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  if (response.status === 204) return undefined as T;
  const result = await response.json();
  if (!response.ok) {
    const parse = result.errors?.map((e: { file: string; line?: number; message: string }) => `${e.file}:${e.line ?? '?'} ${e.message}`).join('\n');
    throw new Error(result.error?.message || parse || `HTTP ${response.status}`);
  }
  return result as T;
}
