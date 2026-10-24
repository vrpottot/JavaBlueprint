import type { IRNode, SourceFile } from '../types/index.js';

type ProjectContext = { files: SourceFile[]; ir: { nodes: IRNode[] }; analysis: unknown };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
const short = (value: unknown, length = 140) => typeof value === 'string' ? value.slice(0, length) : value;
const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Keep provider input bounded and prefer methods explicitly named by the user. */
export function buildPromptContext(project: ProjectContext, message: string, budget: number) {
  const methods = project.ir.nodes.filter(node => node.astKind === 'MethodDeclaration' || node.astKind === 'ConstructorDeclaration');
  const focused = methods.filter(node => new RegExp(`(?<![\\w$])${escaped(node.title)}(?![\\w$])`).test(message));
  const focusIds = new Set(focused.map(node => node.id));
  const related = (node: IRNode) => focusIds.has(node.id) || focusIds.has(node.methodId ?? '');
  const rank = (node: IRNode) => related(node) ? 0 : /(?:^|\/)\w*Test\.java$/.test(node.source.file) ? 2 : 1;
  const nodes = [...project.ir.nodes].sort((a, b) => rank(a) - rank(b));
  const analysis = object(project.analysis);
  const allCosts = Array.isArray(analysis.complexity) ? analysis.complexity.map(object) : [];
  const costs = (focused.length ? allCosts.filter(cost => focusIds.has(String(cost.methodId))) : allCosts).slice(0, 8).map(cost => ({
    method: cost.method, methodId: cost.methodId, file: cost.file, estimate: cost.estimate,
    status: cost.status, explanation: short(cost.explanation),
    assumptions: Array.isArray(cost.assumptions) ? cost.assumptions.slice(0, 1).map(value => short(value)) : [],
    limitations: Array.isArray(cost.limitations) ? cost.limitations.slice(0, 1).map(value => short(value)) : [],
  }));
  const diagnostics = Array.isArray(analysis.diagnostics) ? analysis.diagnostics : Array.isArray(analysis.issues) ? analysis.issues : [];
  const issues = diagnostics.slice(0, 4).map(value => {
    const issue = object(value);
    return { title: short(issue.title, 80), severity: issue.severity ?? issue.level, nodeId: issue.nodeId, file: issue.file, line: issue.line };
  });
  const concise = { metrics: analysis.metrics ?? null, complexity: costs, issues };
  const analysisBudget = Math.floor(budget * 0.2);
  while (JSON.stringify(concise).length > analysisBudget && (costs.length || issues.length)) {
    if (issues.length) issues.pop(); else costs.pop();
  }
  const analysisText = JSON.stringify(concise).length <= analysisBudget ? JSON.stringify(concise) : '{}';

  const nodeBudget = Math.floor(budget * 0.25);
  let nodeText = '';
  for (const node of nodes.filter(node => node.editable.length && (!focused.length || related(node)))) {
    const row = `- ID: "${node.id}", ${node.astKind}, ${node.source.file}:${node.source.startLine}, Editable: [${node.editable.join(', ')}], Snippet: ${JSON.stringify(node.snippet.slice(0, 80))}\n`;
    if (nodeText.length + row.length > nodeBudget) break;
    nodeText += row;
  }

  const sourceBudget = budget - analysisText.length - nodeText.length;
  const fullSources = project.files.map(file => `--- File: ${file.path} ---\n${file.content}\n--- End File ---`).join('\n\n');
  if (fullSources.length <= sourceBudget) return { analysis: analysisText, nodes: nodeText || 'None', sources: fullSources, scope: 'Complete uploaded sources are included.' };

  let sources = '';
  const candidates = focused.length ? focused : methods.sort((a, b) => rank(a) - rank(b));
  for (const method of candidates) {
    const header = `--- Method: ${method.title}, ${method.source.file}:${method.source.startLine} ---\n`;
    const remaining = sourceBudget - sources.length - header.length - 2;
    const omitted = '\n[method truncated: remaining statements omitted]';
    if (remaining < omitted.length + 100) break;
    const code = method.code.length <= remaining ? method.code : method.code.slice(0, remaining - omitted.length) + omitted;
    sources += header + code + '\n\n';
  }
  if (!sources) sources = fullSources.slice(0, Math.max(0, sourceBudget - 40)) + '\n[source truncated]';
  return {
    analysis: analysisText, nodes: nodeText || 'None', sources,
    scope: `Partial project context: ${project.files.length} files, ${methods.length} methods. ${focused.length ? 'Methods named in the request are prioritized.' : 'Only selected method bodies are included.'} Do not claim to review omitted code or dependencies; ask for a specific method when necessary.`,
  };
}
