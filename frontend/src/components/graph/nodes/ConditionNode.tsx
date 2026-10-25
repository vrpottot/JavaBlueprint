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
      className={`${styles.flowNodeContainer} ${styles.decisionNode} ${isSelected ? styles.selected : ''
        }`}
    >
      <Handle type="target" position={Position.Top} id="in" />

      {/* 3. Классический ромб ветвления (ГОСТ / ISO 5807) */}
      <svg
        className={styles.shapeSvgBg}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <polygon
          points="1,50 8,1 92,1 99,50 92,99 8,99"
          className={styles.shapePath}
        />
      </svg>

      <div className={styles.decisionContent}>
        <div className={styles.decisionHeader}>
          <div className={styles.headerLeft}>
            <div className={styles.decisionIcon}>
              <GitFork size={13} />
            </div>
            <span className={styles.nodeTitle}>
              {nodeData.synthetic ? nodeData.title : nodeData.astKind === 'SwitchStmt' ? 'Переключатель (switch)' : 'Условие (if)'}
            </span>
          </div>

          <div className={styles.headerRight}>
            {nodeData.line && <span className={styles.lineBadge}>L:{nodeData.line}</span>}
          </div>
        </div>

        <div className={styles.codeSnippet}>{nodeData.displayCode ?? nodeData.codeSnippet}</div>

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

      {/* Фиксированные выходы: ровно 3 (Да, Нет, и вход/выход к предыдущему блоку) */}
      <Handle type="source" position={Position.Left} id="out-left" title="Да (True)" />
      {nodeData.astKind !== 'SwitchStmt' && <span className={styles.handleTipYes}>Да</span>}

      <Handle type="source" position={Position.Right} id="out-right" title="Нет (False)" />
      {nodeData.astKind !== 'SwitchStmt' && <span className={styles.handleTipNo}>Нет</span>}

      {nodeData.astKind === 'SwitchStmt' && (
        <Handle type="source" position={Position.Bottom} id="out-bottom" title="Ветвление switch" />
      )}
      {nodeData.hasException && <Handle type="source" position={Position.Right} id="out-exception" title="Исключение" style={{ top: '75%', background: '#d97706' }} />}
    </div>
  );
});

ConditionNode.displayName = 'ConditionNode';
