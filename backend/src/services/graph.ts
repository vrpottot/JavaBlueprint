import type { EngineResult } from '../types/index.js';

export function graph(result: EngineResult) {
  const methodColumns = new Map<string, number>();
  const rows = new Map<string, number>();
  const nodes = result.nodes.map(n => {
    const group = n.methodId ?? n.source.file;
    if (!methodColumns.has(group)) methodColumns.set(group, methodColumns.size);
    const row = rows.get(group) ?? 0;
    rows.set(group, row + 1);
    return {
      id: n.id, type: `${n.kind}Node`,
      position: { x: (methodColumns.get(group) ?? 0) * 650 + Math.min(n.depth, 5) * 65, y: row * 195 },
      data: {
        title: n.title, codeSnippet: n.snippet, blockType: n.kind, line: n.source.startLine,
        source: n.source, astKind: n.astKind, editable: n.editable, methodId: n.methodId,
        containerId: n.containerId, method: n.method,
        description: `${n.source.file}:${n.source.startLine}`, badge: n.astKind,
      },
    };
  });
  const kinds = new Map(result.nodes.map(n => [n.id, n.kind]));
  return {
    nodes,
    edges: result.edges.map((e, i) => ({
      id: `${e.source}:${e.target}:${i}`, ...e,
      sourceHandle: kinds.get(e.source) === 'condition' ? e.label === 'true' ? 'out-left' : e.label === 'false' ? 'out-bottom' : 'out-right' : 'out',
      targetHandle: 'in', type: 'smoothstep', animated: e.kind === 'loop',
    })),
    warnings: result.warnings,
  };
}
