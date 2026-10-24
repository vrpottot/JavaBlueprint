import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { CornerDownLeft, AlertTriangle } from 'lucide-react';
import type { VisualBlockData } from '../../../types';
import styles from './NodeStyles.module.scss';

export const ReturnNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as VisualBlockData;
  const isSelected = selected || nodeData.isHighlighted;

  return (
    <div
      className={`${styles.flowNodeContainer} ${styles.terminatorNode} ${styles.returnVariant} ${
        isSelected ? styles.selected : ''
      }`}
    >
      <Handle type="target" position={Position.Top} id="in" />

      {/* 1. ТЕРМИНАТОР: Скругленный овал завершения */}
      <svg
        className={styles.shapeSvgBg}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect
          x="1"
          y="1"
          width="98"
          height="98"
          rx="22"
          ry="22"
          className={styles.shapePath}
        />
      </svg>

      <div className={styles.nodeContent}>
        <div className={styles.nodeHeader}>
          <div className={styles.headerLeft}>
            <div className={styles.headerIcon}>
              <CornerDownLeft size={14} color="#10B981" />
            </div>
            <span className={styles.nodeTitle}>{nodeData.title}</span>
          </div>

          <div className={styles.headerRight}>
            <span className={styles.shapeBadge}>Терминатор</span>
            {nodeData.line && <span className={styles.lineBadge}>L{nodeData.line}</span>}
          </div>
        </div>

        <div className={styles.codeSnippet}>{nodeData.codeSnippet}</div>

        {nodeData.description && (
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

ReturnNode.displayName = 'ReturnNode';
