import type { Node, Edge } from '@xyflow/react';
import type { VisualBlockData } from '../types';

export interface GeneratedCodeResult {
  code: string;
  updated: boolean;
  methodName?: string;
}

/**
 * Escapes regex special characters
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Helper to get all reachable nodes from a start node (BFS)
 */
function getReachableNodes(
  startId: string | null | undefined,
  stopId: string | null | undefined,
  outgoing: Map<string, Edge[]>,
  visited: Set<string>
): string[] {
  if (!startId || startId === stopId) return [];
  const list: string[] = [];
  const queue = [startId];
  const seen = new Set<string>([...visited, startId]);

  while (queue.length > 0) {
    const id = queue.shift()!;
    list.push(id);
    const edges = outgoing.get(id) || [];
    for (const edge of edges) {
      if (edge.target && edge.target !== stopId && !seen.has(edge.target)) {
        seen.add(edge.target);
        queue.push(edge.target);
      }
    }
  }
  return list;
}

/**
 * Traverses the graph from a starting statement node and builds structured Java code lines.
 */
function walkFlow(
  currId: string | null | undefined,
  stopId: string | null | undefined,
  nodeMap: Map<string, Node<VisualBlockData>>,
  outgoing: Map<string, Edge[]>,
  visited: Set<string>,
  methodNodeId: string,
  indent = '        '
): string[] {
  if (!currId || currId === stopId || visited.has(currId)) return [];
  const node = nodeMap.get(currId);
  if (!node || node.id === methodNodeId) return [];
  visited.add(currId);

  const blockType = node.data.blockType;
  const astKind = node.data.astKind;
  const snippet = (node.data.codeSnippet || '').trim();
  const nodeEdges = outgoing.get(currId) || [];

  // 1. Condition (if / switch)
  if (blockType === 'condition' || astKind === 'IfStmt') {
    let condExpr = snippet;
    const ifMatch = condExpr.match(/^if\s*\((.*)\)\s*\{?$/s);
    if (ifMatch && ifMatch[1]) {
      condExpr = ifMatch[1].trim();
    } else if (condExpr.startsWith('if')) {
      condExpr = condExpr.replace(/^if\s*\(?/, '').replace(/\)?\s*\{?$/, '').trim();
    }
    if (!condExpr) condExpr = 'true';

    // Find "Да" (out-left, true) and "Нет" (out-right, false) edges
    const yesEdge = nodeEdges.find(e =>
      e.sourceHandle === 'out-left' ||
      e.label === 'Да' ||
      e.label === 'true' ||
      e.label === 'да'
    ) || nodeEdges[0];

    const noEdge = nodeEdges.find(e =>
      e !== yesEdge && (
        e.sourceHandle === 'out-right' ||
        e.label === 'Нет' ||
        e.label === 'false' ||
        e.label === 'нет'
      )
    ) || (nodeEdges.length > 1 && nodeEdges[1] !== yesEdge ? nodeEdges[1] : undefined);

    const yesTarget = yesEdge?.target;
    const noTarget = noEdge?.target;

    // Detect if branches converge at a join node
    const yesReachable = getReachableNodes(yesTarget, stopId, outgoing, visited);
    const noReachable = getReachableNodes(noTarget, stopId, outgoing, visited);

    let joinNodeId: string | undefined = undefined;
    for (const id of yesReachable) {
      if (noReachable.includes(id)) {
        joinNodeId = id;
        break;
      }
    }

    const yesBody = yesTarget
      ? walkFlow(yesTarget, joinNodeId || stopId, nodeMap, outgoing, new Set(visited), methodNodeId, indent + '    ')
      : [];
    const noBody = (noTarget && noTarget !== joinNodeId)
      ? walkFlow(noTarget, joinNodeId || stopId, nodeMap, outgoing, new Set(visited), methodNodeId, indent + '    ')
      : [];

    const lines: string[] = [];
    lines.push(`${indent}if (${condExpr}) {`);
    if (yesBody.length > 0) {
      lines.push(...yesBody);
    }
    if (noBody.length > 0) {
      lines.push(`${indent}} else {`);
      lines.push(...noBody);
    }
    lines.push(`${indent}}`);

    if (joinNodeId) {
      lines.push(...walkFlow(joinNodeId, stopId, nodeMap, outgoing, visited, methodNodeId, indent));
    } else if (noTarget && !noBody.length && yesBody.some(l => l.includes('return '))) {
      // If "yes" branch returns early, "no" branch can be consecutive statements
      lines.push(...walkFlow(noTarget, stopId, nodeMap, outgoing, visited, methodNodeId, indent));
    }

    return lines;
  }

  // 2. Loop (for / while / do-while / foreach)
  if (blockType === 'loop' || astKind?.includes('For') || astKind?.includes('While') || astKind?.includes('Do')) {
    let loopHeader = snippet;
    if (!loopHeader.endsWith('{') && !loopHeader.endsWith(')')) {
      if (!loopHeader.startsWith('for') && !loopHeader.startsWith('while') && !loopHeader.startsWith('do')) {
        loopHeader = `for (${loopHeader})`;
      }
    }
    if (loopHeader.endsWith('{')) loopHeader = loopHeader.slice(0, -1).trim();

    const bodyEdge = nodeEdges.find(e =>
      e.sourceHandle === 'out' ||
      e.label === 'Тело цикла' ||
      e.label === 'repeat'
    );
    const exitEdge = nodeEdges.find(e =>
      e.sourceHandle === 'out-exit' ||
      e.label === 'Выход' ||
      e.label === 'exit'
    ) || (nodeEdges.length > 1 && nodeEdges[1] !== bodyEdge ? nodeEdges[1] : undefined);

    const bodyLines = bodyEdge
      ? walkFlow(bodyEdge.target, currId, nodeMap, outgoing, new Set(visited), methodNodeId, indent + '    ')
      : [];

    const lines: string[] = [];
    lines.push(`${indent}${loopHeader} {`);
    if (bodyLines.length > 0) {
      lines.push(...bodyLines);
    }
    lines.push(`${indent}}`);

    if (exitEdge?.target && exitEdge.target !== currId) {
      lines.push(...walkFlow(exitEdge.target, stopId, nodeMap, outgoing, visited, methodNodeId, indent));
    }
    return lines;
  }

  // 3. Return statement
  if (blockType === 'return' || astKind === 'ReturnStmt') {
    let retStmt = snippet;
    if (!retStmt.startsWith('return')) retStmt = `return ${retStmt}`;
    if (!retStmt.endsWith(';')) retStmt += ';';
    return [`${indent}${retStmt}`];
  }

  // 4. Operation or Variable
  let stmt = snippet;
  if (!stmt.endsWith(';') && !stmt.endsWith('}')) {
    stmt += ';';
  }

  const lines = [`${indent}${stmt}`];

  if (astKind === 'ThrowStmt' || stmt.startsWith('throw ')) {
    return lines; // Throw terminates sequence
  }

  const nextEdge = nodeEdges.find(e => e.sourceHandle === 'out' || !e.sourceHandle) || nodeEdges[0];
  if (nextEdge?.target && nextEdge.target !== currId) {
    lines.push(...walkFlow(nextEdge.target, stopId, nodeMap, outgoing, visited, methodNodeId, indent));
  }

  return lines;
}

/**
 * Replaces the method body in the given Java source code.
 */
function replaceMethodBodyInJavaSource(
  fileContent: string,
  methodName: string,
  startLine: number | undefined,
  newBodyStatements: string[]
): string | null {
  const lines = fileContent.split('\n');

  // Search around startLine first, or anywhere in file
  let methodLineIndex = -1;
  const cleanName = methodName.replace(/^(Метод|Конструктор):\s*/, '').trim();

  // Try finding by startLine (1-based index)
  if (startLine && startLine > 0 && startLine <= lines.length) {
    for (let i = Math.max(0, startLine - 3); i < Math.min(lines.length, startLine + 3); i++) {
      if (lines[i].includes(cleanName) && lines[i].includes('(')) {
        methodLineIndex = i;
        break;
      }
    }
  }

  // Fallback: search anywhere
  if (methodLineIndex === -1) {
    const regex = new RegExp(`\\b${escapeRegExp(cleanName)}\\s*\\(`);
    methodLineIndex = lines.findIndex(l => regex.test(l));
  }

  if (methodLineIndex === -1) return null;

  // Find the opening brace of this method
  let openBracePos = -1;
  let charOffset = 0;
  for (let i = 0; i < methodLineIndex; i++) {
    charOffset += lines[i].length + 1; // +1 for newline
  }

  const restOfFile = fileContent.slice(charOffset);
  const openBraceRelative = restOfFile.indexOf('{');
  if (openBraceRelative === -1) return null;
  openBracePos = charOffset + openBraceRelative;

  // Find the matching closing brace
  let depth = 1;
  let closeBracePos = -1;
  for (let i = openBracePos + 1; i < fileContent.length; i++) {
    const ch = fileContent[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        closeBracePos = i;
        break;
      }
    }
  }

  if (closeBracePos === -1) return null;

  // Indent closing brace properly
  const formattedBody = newBodyStatements.join('\n');
  const replacement = `{\n${formattedBody}\n    }`;

  return fileContent.slice(0, openBracePos) + replacement + fileContent.slice(closeBracePos + 1);
}

/**
 * Regenerates the Java source code of a file based on updated graph nodes and edges.
 */
export function generateJavaCodeFromGraph(
  currentFileContent: string,
  nodes: Node<VisualBlockData>[],
  edges: Edge[],
  targetMethodId?: string | null
): GeneratedCodeResult {
  if (!currentFileContent || !nodes.length) {
    return { code: currentFileContent, updated: false };
  }

  // Locate the target method node
  let methodNode: Node<VisualBlockData> | undefined;
  if (targetMethodId && targetMethodId !== 'all' && targetMethodId !== 'members') {
    methodNode = nodes.find(n => n.id === targetMethodId && n.data.blockType === 'method');
  }

  if (!methodNode) {
    // If not directly specified, find methods in the active file
    const fileMethods = nodes.filter(n => n.data.blockType === 'method');
    if (fileMethods.length === 1) {
      methodNode = fileMethods[0];
    } else {
      // Find method with the most recent edge connection
      const methodWithEdges = fileMethods.find(m =>
        edges.some(e => e.source === m.id || nodes.some(n => n.data.methodId === m.id && (n.id === e.source || n.id === e.target)))
      );
      methodNode = methodWithEdges || fileMethods[0];
    }
  }

  if (!methodNode) {
    return { code: currentFileContent, updated: false };
  }

  const methodId = methodNode.id;
  const statementNodes = nodes.filter(n => n.data.methodId === methodId && n.id !== methodId);
  if (!statementNodes.length) {
    return { code: currentFileContent, updated: false };
  }

  // Build node and edge mappings for this method
  const nodeMap = new Map<string, Node<VisualBlockData>>();
  statementNodes.forEach(n => nodeMap.set(n.id, n));
  nodeMap.set(methodNode.id, methodNode);

  const outgoing = new Map<string, Edge[]>();
  edges.forEach(e => {
    if (nodeMap.has(e.source) && nodeMap.has(e.target)) {
      if (!outgoing.has(e.source)) outgoing.set(e.source, []);
      outgoing.get(e.source)!.push(e);
    }
  });

  // Find start node from method node's outgoing edge
  const startEdges = outgoing.get(methodNode.id) || [];
  let startNodeId = startEdges[0]?.target;
  if (!startNodeId && statementNodes.length > 0) {
    // Fallback: earliest statement
    startNodeId = statementNodes.slice().sort((a, b) => (a.data.line ?? 0) - (b.data.line ?? 0))[0]?.id;
  }

  if (!startNodeId) {
    return { code: currentFileContent, updated: false };
  }

  // Walk the graph flow to generate structured statements
  const visited = new Set<string>();
  const generatedLines = walkFlow(
    startNodeId,
    undefined,
    nodeMap,
    outgoing,
    visited,
    methodNode.id,
    '        '
  );

  if (!generatedLines.length) {
    return { code: currentFileContent, updated: false };
  }

  const methodName = methodNode.data.method?.name || methodNode.data.title || 'method';
  const startLine = methodNode.data.source?.startLine;

  const newCode = replaceMethodBodyInJavaSource(currentFileContent, methodName, startLine, generatedLines);

  if (!newCode || newCode === currentFileContent) {
    return { code: currentFileContent, updated: false, methodName };
  }

  return {
    code: newCode,
    updated: true,
    methodName,
  };
}
