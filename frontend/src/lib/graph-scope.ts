import type { Node } from '@xyflow/react';
import type { VisualBlockData } from '../types';

export function defaultMethod(nodes: Node<VisualBlockData>[], file: string) {
  const fileNodes = nodes.filter(node => node.data.source?.file === file);
  const methods = fileNodes.filter(node => node.data.blockType === 'method');
  if (methods.length === 1) return methods[0].id;
  return 'all';
}

export function scopeNodes(nodes: Node<VisualBlockData>[], file: string, method: string) {
  return nodes.filter(node => node.data.source?.file === file && (method === 'all' || (method === 'members' ? !node.data.methodId : node.data.methodId === method)));
}
