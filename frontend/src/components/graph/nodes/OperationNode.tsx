import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Plus, AlertTriangle, ShieldAlert, AlertOctagon, Terminal, Layers } from 'lucide-react';
import type { VisualBlockData } from '../../../types';
import styles from './NodeStyles.module.scss';

export const OperationNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as VisualBlockData;
  const isSelected = selected || nodeData.isHighlighted;

  const isTry = nodeData.astKind === 'TryStmt' || Boolean(nodeData.codeSnippet?.startsWith('try'));
  const isThrow = nodeData.astKind === 'ThrowStmt' || Boolean(nodeData.codeSnippet?.startsWith('throw'));
  const isScanner = Boolean(nodeData.codeSnippet?.includes('Scanner'));
  const isPrint = Boolean(nodeData.codeSnippet?.includes('System.out'));
  const isErr = Boolean(nodeData.codeSnippet?.includes('System.err'));
  const isCollection = Boolean(nodeData.codeSnippet?.match(/\b(List|ArrayList|LinkedList|Set|HashSet|TreeSet|Map|HashMap|TreeMap|Collections|Arrays)\b/));
  const isBreak = nodeData.astKind === 'BreakStmt';
  const isContinue = nodeData.astKind === 'ContinueStmt';

  let title = 'Операция';
  let icon = <Plus size={13} />;

  if (isTry) {
    title = 'Try / Catch / Finally';
    icon = <ShieldAlert size={13} />;
  } else if (isThrow) {
    title = 'Исключение (throw)';
    icon = <AlertOctagon size={13} />;
  } else if (isScanner) {
    title = 'Ввод (Scanner)';
    icon = <Terminal size={13} />;
  } else if (isErr) {
    title = 'Вывод ошибки (System.err)';
    icon = <Terminal size={13} />;
  } else if (isPrint) {
    title = 'Вывод (System.out)';
    icon = <Terminal size={13} />;
  } else if (isCollection) {
    title = 'Коллекция';
    icon = <Layers size={13} />;
  } else if (isBreak) {
    title = 'Прерывание (break)';
  } else if (isContinue) {
    title = 'Продолжить (continue)';
  } else if (nodeData.title && nodeData.title !== 'Expression' && nodeData.title !== 'ExpressionStmt') {
    title = nodeData.title;
  }

  return (
    <div
      className={`${styles.flowNodeContainer} ${styles.processNode} ${
        isSelected ? styles.selected : ''
      }`}
    >
      <Handle type="target" position={Position.Top} id="in" />
      <Handle type="target" position={Position.Left} id="in-left" />
      <Handle type="target" position={Position.Right} id="in-right" />

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
              {icon}
            </div>
            <span className={styles.nodeTitle}>{title}</span>
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
      <Handle type="source" position={Position.Right} id="out-right" />
    </div>
  );
});

OperationNode.displayName = 'OperationNode';
