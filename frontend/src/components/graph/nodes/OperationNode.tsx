import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { PlayCircle, AlertTriangle } from 'lucide-react';
import type { VisualBlockData } from '../../../types';
import styles from './NodeStyles.module.scss';

export const OperationNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as VisualBlockData;
  const isSelected = selected || nodeData.isHighlighted;

  return (
    <div
      className={`${styles.flowNodeContainer} ${styles.processNode} ${
        isSelected ? styles.selected : ''
      }`}
    >
      <Handle type="target" position={Position.Top} id="in" />
      <Handle type="target" position={Position.Left} id="in-left" />

      {/* 5. ПРОЦЕСС: Четкий прямоугольник (ГОСТ 19.701-90 / ISO 5807) */}
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
          rx="4"
          ry="4"
          className={styles.shapePath}
        />
      </svg>

      <div className={styles.nodeContent}>
        <div className={styles.nodeHeader}>
          <div className={styles.headerLeft}>
            <div className={styles.headerIcon}>
              <PlayCircle size={14} color="#3FB950" />
            </div>
            <span className={styles.nodeTitle}>{nodeData.title}</span>
          </div>

          <div className={styles.headerRight}>
            <span className={styles.shapeBadge}>Процесс</span>
            {nodeData.line && <span className={styles.lineBadge}>L{nodeData.line}</span>}
          </div>
        </div>

        <div className={styles.codeSnippet} title={nodeData.codeSnippet}>{nodeData.displayCode ?? nodeData.codeSnippet}</div>

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
      <Handle type="source" position={Position.Right} id="out-right" />
    </div>
  );
});

OperationNode.displayName = 'OperationNode';

