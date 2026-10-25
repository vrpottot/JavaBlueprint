import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Box, AlertTriangle } from 'lucide-react';
import type { VisualBlockData } from '../../../types';
import styles from './NodeStyles.module.scss';

export const VariableNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as VisualBlockData;
  const isSelected = selected || nodeData.isHighlighted;

  return (
    <div
      className={`${styles.flowNodeContainer} ${styles.dataNode} ${
        isSelected ? styles.selected : ''
      }`}
    >
      <Handle type="target" position={Position.Top} id="in" />

      {/* 2. Параллелограмм со скошенными сторонами */}
      <svg
        className={styles.shapeSvgBg}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <polygon
          points="7,1 99,1 93,99 1,99"
          className={styles.shapePath}
        />
      </svg>

      <div className={styles.nodeContent}>
        <div className={styles.nodeHeader}>
          <div className={styles.headerLeft}>
            <div className={styles.headerIcon}>
              <Box size={13} />
            </div>
            <span className={styles.nodeTitle}>Переменная</span>
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

VariableNode.displayName = 'VariableNode';
