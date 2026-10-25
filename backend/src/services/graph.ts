import dagre from '@dagrejs/dagre';
import type { EngineResult } from '../types/index.js';

export function graph(result: EngineResult) {
  const byId = new Map(result.nodes.map(node => [node.id, node]));
  const owners = new Map(result.containers?.map(owner => [owner.id, owner.name]));
  const nodes = result.nodes.map(n => ({
    id: n.id, type: `${n.kind}Node`, position: { x: 0, y: 0 },
    data: {
      title: n.title, codeSnippet: n.snippet, displayCode: n.displayCode ?? n.snippet,
      blockType: n.kind, line: n.source.startLine, warning: n.warning,
      source: n.source, astKind: n.astKind, editable: n.editable, methodId: n.methodId,
      containerId: n.containerId, containerName: owners.get(n.containerId ?? ''), method: n.method,
      description: `${owners.get(n.containerId ?? '') ?? ''} · ${n.source.file}:${n.source.startLine}`, badge: n.astKind,
    },
  }));
  const groups = new Map<string, typeof nodes>();
  for (const node of nodes) {
    const key = node.data.methodId ?? `${node.data.source.file}:members`;
    const group = groups.get(key) ?? [];
    group.push(node); groups.set(key, group);
  }
  let offset = 0;
  for (const group of groups.values()) {
    if (!group[0]?.data.methodId) {
      group.forEach((node, index) => { node.position = { x: offset, y: index * 330 }; });
      offset += 650;
      continue;
    }
    const ids = new Set(group.map(node => node.id));
    const layout = new dagre.graphlib.Graph({ multigraph: true });
    layout.setGraph({ rankdir: 'TB', nodesep: 100, ranksep: 100, edgesep: 30, marginx: 40, marginy: 40 });
    layout.setDefaultEdgeLabel(() => ({}));
    for (const node of group) layout.setNode(node.id, {
      width: node.data.blockType === 'condition' ? 500 : 400,
      height: node.data.blockType === 'condition' ? 320 : node.data.warning ? 300 : 240,
    });
    result.edges.forEach((edge, index) => { if (ids.has(edge.source) && ids.has(edge.target)) layout.setEdge(edge.source, edge.target, {}, String(index)); });
    dagre.layout(layout);
    for (const node of group) {
      const point = layout.node(node.id);
      node.position = { x: offset + point.x - point.width / 2, y: point.y - point.height / 2 };
    }
    offset += (layout.graph().width ?? 650) + 250;
  }
  const within = (source: string, ancestor: string) => {
    let parent = byId.get(source)?.parentId;
    while (parent) { if (parent === ancestor) return true; parent = byId.get(parent)?.parentId; }
    return false;
  };
  return {
    nodes,
    edges: result.edges.filter(edge => byId.has(edge.source) && byId.has(edge.target)).map((e, i) => {
      const source = byId.get(e.source), target = byId.get(e.target);
      const back = target?.kind === 'loop' && within(e.source, e.target);
      return {
        id: `${e.source}:${e.target}:${i}`, ...e,
        sourceHandle: source?.kind === 'condition' ? e.label === 'true' ? 'out-left' : e.label === 'false' ? 'out-bottom' : 'out-right' : source?.kind === 'loop' && e.label === 'exit' ? 'out-exit' : 'out',
        targetHandle: back ? 'loop-in' : 'in', type: 'smoothstep', animated: back,
        markerEnd: { type: 'arrowclosed', width: 16, height: 16 },
        ...(e.kind === 'exception' ? { style: { stroke: '#d97706', strokeDasharray: '6 4' } } : {}),
      };
    }),
    warnings: result.warnings,
  };
}
