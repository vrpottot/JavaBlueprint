import type { Node } from '@xyflow/react';
import type { VisualBlockData } from '../types';

export function defaultMethod(nodes: Node<VisualBlockData>[], file: string) {
  const methods = nodes.filter(node => node.data.source?.file === file && node.data.blockType === 'method');
  return methods.find(node => node.data.title === 'main')?.id ?? methods[0]?.id ?? 'members';
}

export function scopeNodes(nodes: Node<VisualBlockData>[], file: string, method: string) {
  return nodes.filter(node => node.data.source?.file === file && (method === 'all' || (method === 'members' ? !node.data.methodId : node.data.methodId === method)));
}
