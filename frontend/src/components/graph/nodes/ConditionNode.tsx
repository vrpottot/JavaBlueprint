import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { GitFork, AlertTriangle } from 'lucide-react';
import type { VisualBlockData } from '../../../types';
import styles from './NodeStyles.module.scss';

export const ConditionNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as VisualBlockData;
  const isSelected = selected || nodeData.isHighlighted;

  return (
    <div
      className={`${styles.flowNodeContainer} ${styles.decisionNode} ${
        isSelected ? styles.selected : ''
      }`}
    >
      <Handle type="target" position={Position.Top} id="in" />

      {/* 3. РЕШЕНИЕ: Классический ромб ветвления (ГОСТ / ISO 5807) */}
      <svg
        className={styles.shapeSvgBg}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <polygon
          points="50,1 99,50 50,99 1,50"
          className={styles.shapePath}
        />
      </svg>

      <div className={styles.decisionContent}>
        <div className={styles.decisionHeader}>
          <GitFork size={12} color="#F59E0B" />
          <span className={styles.shapeBadge}>Решение</span>
          {nodeData.line && <span className={styles.lineBadge}>L{nodeData.line}</span>}
        </div>

        <div className={styles.decisionTitle}>{nodeData.title}</div>

        <div className={styles.decisionCodeSnippet}>{nodeData.codeSnippet}</div>

        {nodeData.description && (
          <div className={styles.decisionDescription}>{nodeData.description}</div>
        )}

        {nodeData.warning && (
          <div className={styles.decisionWarning}>
            <AlertTriangle size={11} />
            <span>{nodeData.warning}</span>
          </div>
        )}
      </div>

      {/* Connection Handles on vertices with external label indicators */}
      <Handle type="source" position={Position.Left} id="out-left" title="Да (True)" />
      <span className={styles.handleTipLeft}>Да</span>

      <Handle type="source" position={Position.Bottom} id="out-bottom" title="Нет (False)" />
      <span className={styles.handleTipBottom}>Нет</span>

      <Handle type="source" position={Position.Right} id="out-right" title="Ветвление" />
    </div>
  );
});

ConditionNode.displayName = 'ConditionNode';
