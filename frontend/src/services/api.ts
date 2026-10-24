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
  complexity: { methodId: string; method: string; file: string; line: number; estimate: string; status: 'estimated' | 'unknown'; structuralBound: string; explanation: string; assumptions: string[]; limitations: string[]; evidence: { line: number; estimate: string; rule: string }[] }[];
  metrics: CodeMetrics;
}
export interface Execution { stdout: string; stderr: string; exitCode: number | null; durationMs: number; timedOut: boolean; outputLimitExceeded: boolean }
export interface VersionResult { compilation: Execution; runs: (Execution & { name: string; passed: boolean | null })[]; tests: { status: string; cases: TestCase[] } }
export interface Verification { revision: number; current: VersionResult; original?: VersionResult; comparison: { status: string; explanation: string; provenEquivalent: false } }
const base = import.meta.env.VITE_API_URL || '/api';
export async function api<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(180000),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Не удалось подключиться к бэкенду (${path}): ${msg}. Убедитесь, что бэкенд запущен на порту 3001.`);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let result: any = null;
  if (text) {
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error(`Бэкенд вернул не-JSON ответ (HTTP ${response.status}): ${text.slice(0, 120)}`);
    }
  } else if (!response.ok) {
    throw new Error(`Бэкенд недоступен (HTTP ${response.status}). Запустите бэкенд-сервер на порту 3001.`);
  }

  if (!response.ok) {
    const parse = result?.errors?.map((e: { file: string; line?: number; message: string }) => `${e.file}:${e.line ?? '?'} ${e.message}`).join('\n');
    throw new Error(result?.error?.message || parse || `HTTP ${response.status}`);
  }

  return result as T;
}

export interface AIProviderConfig {
  provider?: 'gemini' | 'openai' | 'anthropic' | 'ollama' | 'openrouter' | 'omniroute';
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export interface AIChatResponse {
  reply: string;
  proposal?: import('../types').AIProposal;
  parsedAnalysis?: {
    complexity?: import('../types').ComplexityEstimate;
    metrics?: Partial<import('../types').CodeMetrics>;
    issues?: import('../types').CodeIssue[];
    recommendations?: import('../types').CodeRecommendation[];
  };
}

export interface AIProposalResponse extends ProjectSnapshot {
  verification: Verification;
  comparisonBaseline: string;
}

export async function sendAIChatMessage(
  projectId: string,
  message: string,
  config?: AIProviderConfig
): Promise<AIChatResponse> {
  return await api<AIChatResponse>(`/projects/${projectId}/ai-chat`, { message, config });
}

export async function streamAIChatMessage(
  projectId: string,
  message: string,
  onChunk: (deltaText: string) => void,
  config?: AIProviderConfig
): Promise<{ proposal?: import('../types').AIProposal; parsedAnalysis?: AIChatResponse['parsedAnalysis']; fullReply: string }> {
  const res = await fetch(`/api/projects/${projectId}/ai-chat-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, config }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ошибка подключения к потоку ИИ (HTTP ${res.status}): ${err}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('ReadableStream не поддерживается браузером');

  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: { proposal?: import('../types').AIProposal; parsedAnalysis?: AIChatResponse['parsedAnalysis']; fullReply: string } = { fullReply: '' };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const evt of events) {
      const lines = evt.split('\n');
      let eventType = '';
      let dataStr = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          dataStr = line.slice(6).trim();
        }
      }

      if (eventType === 'chunk' && dataStr) {
        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.text) {
            onChunk(parsed.text);
          }
        } catch {}
      } else if (eventType === 'done' && dataStr) {
        try {
          finalResult = JSON.parse(dataStr);
        } catch {}
      } else if (eventType === 'error' && dataStr) {
        try {
          const parsed = JSON.parse(dataStr);
          throw new Error(parsed.error || 'Ошибка в потоке ИИ');
        } catch (e) {
          throw e instanceof Error ? e : new Error(String(e));
        }
      }
    }
  }

  return finalResult;
}

export async function submitAIProposal(
  projectId: string,
  proposal: import('../types').AIProposal
): Promise<AIProposalResponse> {
  return await api<AIProposalResponse>(`/projects/${projectId}/ai-proposals`, proposal);
}

