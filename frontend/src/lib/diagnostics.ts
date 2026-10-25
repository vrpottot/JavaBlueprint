import type { Node } from '@xyflow/react';
import type { CodeIssue, IssueSeverity, VisualBlockData } from '../types';

const priority: Record<IssueSeverity, number> = { high: 3, medium: 2, low: 1 };
export function nodeIssues(node: Node<VisualBlockData>, issues: CodeIssue[], origins?: ReadonlyMap<string, string>) {
  return issues.filter(issue => !issue.resolved && issue.file === node.data.source?.file &&
    (issue.nodeId ? (origins?.get(issue.nodeId) ?? issue.nodeId) === (node.data.originId ?? node.id) : issue.line === node.data.source?.startLine));
}
export function decorateDiagnostics(nodes: Node<VisualBlockData>[], issues: CodeIssue[]) {
  const origins = new Map(nodes.map(node => [node.id, node.data.originId ?? node.id]));
  return nodes.map(node => {
    const matches = nodeIssues(node, issues, origins);
    if (!matches.length) return node;
    const level = matches.reduce((result, issue) => priority[issue.level] > priority[result] ? issue.level : result, 'low' as IssueSeverity);
    const text = matches.map(issue => `${issue.title}: ${issue.description}`).join('\n');
    return { ...node, className: `${node.className ?? ''} diagnostic-node diagnostic-${level}`,
      ariaLabel: `${node.data.title}. ${matches.length} замечаний. ${text}`,
      domAttributes: { ...node.domAttributes, title: text },
      data: { ...node.data, issueCount: matches.length, issueLevel: level } };
  });
}
