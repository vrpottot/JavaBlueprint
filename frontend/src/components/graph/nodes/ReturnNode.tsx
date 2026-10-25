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
      {/* Ровно один вход/выход к предыдущему блоку (вход возврата) */}
      <Handle type="target" position={Position.Top} id="in" title="Вход от предыдущего блока" />

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
              <CornerDownLeft size={13} />
            </div>
            <span className={styles.nodeTitle}>{nodeData.synthetic ? nodeData.title : 'Возврат'}</span>
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

      {nodeData.hasException && <Handle type="source" position={Position.Right} id="out-exception" title="Исключение" style={{ top: '75%', background: '#d97706' }} />}
    </div>
  );
});

ReturnNode.displayName = 'ReturnNode';
