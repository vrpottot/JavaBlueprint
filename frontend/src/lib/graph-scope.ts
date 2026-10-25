import type { Node } from '@xyflow/react';
import type { VisualBlockData } from '../types';

export function defaultMethod(nodes: Node<VisualBlockData>[], file: string) {
  const fileNodes = nodes.filter(node => node.data.source?.file === file);
  const methods = fileNodes.filter(node => node.data.blockType === 'method');
  const methodWithCondition = methods.find(m => fileNodes.some(n => n.data.methodId === m.id && n.data.blockType === 'condition'));
  if (methodWithCondition) return methodWithCondition.id;
  const methodWithLoop = methods.find(m => fileNodes.some(n => n.data.methodId === m.id && n.data.blockType === 'loop'));
  if (methodWithLoop) return methodWithLoop.id;
  return methods.find(node => node.data.title === 'main')?.id ?? methods[0]?.id ?? 'members';
}

export function scopeNodes(nodes: Node<VisualBlockData>[], file: string, method: string) {
  return nodes.filter(node => node.data.source?.file === file && (method === 'all' || (method === 'members' ? !node.data.methodId : node.data.methodId === method)));
}
