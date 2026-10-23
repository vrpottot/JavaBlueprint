import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Database, AlertTriangle } from 'lucide-react';
import type { VisualBlockData } from '../../../types';
import styles from './NodeStyles.module.scss';

export const VariableNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as VisualBlockData;
  const isSelected = selected || nodeData.isHighlighted;

  return (
    <div
      className={`${styles.baseNode} ${styles.variableNode} ${isSelected ? styles.selected : ''} ${
        nodeData.warning ? styles.hasWarning : ''
      }`}
    >
      <Handle type="target" position={Position.Top} id="in" />

      <div className={styles.nodeHeader}>
        <div className={styles.headerLeft}>
          <span className={styles.typeIndicator} />
          <Database size={13} color="#4294F7" />
          <span>{nodeData.title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {nodeData.badge && <span className={styles.badge}>{nodeData.badge}</span>}
          {nodeData.line && <span className={styles.lineNum}>L{nodeData.line}</span>}
        </div>
      </div>

      <div className={styles.nodeBody}>
        <div className={styles.codeSnippet}>{nodeData.codeSnippet}</div>
        {nodeData.description && <div className={styles.description}>{nodeData.description}</div>}

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

VariableNode.displayName = 'VariableNode';
