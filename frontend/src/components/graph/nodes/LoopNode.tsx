import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import type { VisualBlockData } from '../../../types';
import styles from './NodeStyles.module.scss';

export const LoopNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as VisualBlockData;
  const isSelected = selected || nodeData.isHighlighted;

  return (
    <div
      className={`${styles.flowNodeContainer} ${styles.preparationNode} ${
        isSelected ? styles.selected : ''
      }`}
    >
      <Handle type="target" position={Position.Top} id="in" />

      {/* 4. Шестиугольник со скошенными углами (ГОСТ / ISO) */}
      <svg
        className={styles.shapeSvgBg}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <polygon
          points="10,1 90,1 99,50 90,99 10,99 1,50"
          className={styles.shapePath}
        />
      </svg>

      <div className={styles.nodeContent}>
        <div className={styles.nodeHeader}>
          <div className={styles.headerLeft}>
            <div className={styles.headerIcon}>
              <RefreshCw size={13} />
            </div>
            <span className={styles.nodeTitle}>
              {nodeData.astKind === 'ForEachStmt'
                ? 'Цикл (foreach)'
                : nodeData.astKind === 'WhileStmt'
                ? 'Цикл (while)'
                : nodeData.astKind === 'DoStmt'
                ? 'Цикл (do-while)'
                : 'Цикл (for)'}
            </span>
          </div>

          <div className={styles.headerRight}>
            {nodeData.line && <span className={styles.lineBadge}>L:{nodeData.line}</span>}
          </div>
        </div>

        <div className={styles.codeSnippet} title={nodeData.displayCode ?? nodeData.codeSnippet}>{nodeData.displayCode ?? nodeData.codeSnippet}</div>

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

      <Handle type="target" position={Position.Left} id="loop-in" title="Следующая итерация" />

      {/* 2 выхода: «Тело цикла» (повторение) снизу, «Выход» (завершение) справа */}
      <Handle type="source" position={Position.Bottom} id="out" title="Тело цикла" />
      <span className={styles.handleTipBottomLoop}>Тело цикла</span>

      <Handle type="source" position={Position.Right} id="out-exit" title="Выход" />
      <span className={styles.handleTipRight}>Выход</span>
    </div>
  );
});

LoopNode.displayName = 'LoopNode';
