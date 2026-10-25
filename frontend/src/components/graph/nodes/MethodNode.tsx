import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Code2, AlertTriangle } from 'lucide-react';
import type { VisualBlockData } from '../../../types';
import styles from './NodeStyles.module.scss';

export const MethodNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as VisualBlockData;
  const isSelected = selected || nodeData.isHighlighted;

  const isConstructor = nodeData.astKind === 'ConstructorDeclaration';
  const prefix = isConstructor ? 'Конструктор' : 'Метод';
  let methodName = nodeData.method?.name;
  if (!methodName && nodeData.title) {
    const trimmed = nodeData.title.trim();
    if (trimmed.startsWith('Метод:') || trimmed.startsWith('Конструктор:')) {
      methodName = trimmed.replace(/^(Метод|Конструктор):\s*/, '');
    } else if (trimmed !== 'Метод' && trimmed !== 'Конструктор') {
      methodName = trimmed;
    }
  }
  if (!methodName && nodeData.codeSnippet) {
    const match = nodeData.codeSnippet.match(/([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/);
    if (match && match[1] && !['if', 'for', 'while', 'switch', 'catch'].includes(match[1])) {
      methodName = match[1];
    }
  }
  const displayTitle = methodName ? `${prefix}: ${methodName}` : prefix;

  return (
    <div
      className={`${styles.flowNodeContainer} ${styles.terminatorNode} ${
        isSelected ? styles.selected : ''
      }`}
    >
      <Handle type="target" position={Position.Top} id="in" />
      <Handle type="target" position={Position.Left} id="in-left" />

      {/* Прямоугольник со скруглением 10px */}
      <svg
        className={styles.shapeSvgBg}
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect
          x="1"
          y="1"
          width="calc(100% - 2px)"
          height="calc(100% - 2px)"
          rx="10"
          ry="10"
          className={styles.shapePath}
        />
      </svg>

      <div className={styles.nodeContent}>
        <div className={styles.nodeHeader}>
          <div className={styles.headerLeft}>
            <div className={styles.headerIcon}>
              <Code2 size={13} />
            </div>
            <span className={styles.nodeTitle}>{displayTitle}</span>
          </div>

          <div className={styles.headerRight}>
            {nodeData.line && <span className={styles.lineBadge}>L:{nodeData.line}</span>}
          </div>
        </div>

        <div className={styles.codeSnippet} title={nodeData.codeSnippet}>{nodeData.displayCode ?? nodeData.codeSnippet}</div>

        {nodeData.description && !nodeData.description.includes('.java') && (
          <div className={styles.description}>{nodeData.description}</div>
        )}

        {nodeData.warning && (
          <div className={styles.warningBox}>
            <AlertTriangle size={12} />
            <span>{nodeData.warning}</span>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} id="out" />
    </div>
  );
});

MethodNode.displayName = 'MethodNode';
