import React, { useEffect, useRef, useState } from 'react';
import { X, Trash2, Check, Code } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import type { Node } from '@xyflow/react';
import type { VisualBlockData } from '../../types';
import styles from './NodeEditModal.module.scss';

const getBlockDisplayTitle = (node: Node<VisualBlockData>) => {
  const type = node.data.blockType || node.type?.replace('Node', '');
  if (type === 'method') {
    const prefix = node.data.astKind === 'ConstructorDeclaration' ? 'Конструктор' : 'Метод';
    const name = node.data.method?.name || node.data.title;
    return name && !name.startsWith('Метод') && !name.startsWith('Конструктор') ? `${prefix}: ${name}` : (name || prefix);
  }
  switch (type) {
    case 'variable': return 'Переменная';
    case 'condition': return 'Условие';
    case 'loop': return 'Цикл';
    case 'operation': return 'Операция';
    case 'return': return 'Возврат';
    default: return node.data.title || node.id;
  }
};

function NodeEditForm({ node }: { node: Node<VisualBlockData> }) {
  const [code, setCode] = useState(node.data.codeSnippet || '');
  const close = useProjectStore(s => s.setEditingNode);
  const save = useProjectStore(s => s.updateNodeData);
  const remove = useProjectStore(s => s.deleteNode);
  const pending = useProjectStore(s => s.isLoading);
  const error = useProjectStore(s => s.error);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const failure = useRef<HTMLParagraphElement>(null);

  const supported = node.data.editable ?? [];
  const editable = supported.some(op => ['updateCondition', 'updateExpression', 'updateVariable', 'replaceStatement'].includes(op));
  const field = supported.includes('updateCondition') ? 'Условие Java' : node.data.astKind === 'FieldDeclaration' ? 'Начальное значение' : node.data.astKind === 'SwitchStmt' ? 'Выражение switch' : node.data.astKind === 'ForEachStmt' ? 'Массив или коллекция для обхода' : 'Java-инструкция целиком';

  const displayTitle = getBlockDisplayTitle(node);
  const blockType = node.data.blockType || 'method';
  const typeValue = node.data.badge || node.data.astKind || displayTitle;
  const startLine = node.data.line ?? (node.data.source as any)?.startLine;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    textarea.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);

  useEffect(() => { if (error) failure.current?.focus(); }, [error]);
  useEffect(() => { if (pending) form.current?.focus(); }, [pending]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editable && !pending && code.trim()) {
      void save(node.id, { codeSnippet: code });
    }
  };

  return (
    <form
      ref={form}
      tabIndex={-1}
      aria-busy={pending}
      className={styles.modalContent}
      onClick={e => e.stopPropagation()}
      onSubmit={handleSubmit}
      onKeyDown={e => {
        if (e.key === 'Escape' && !pending) { e.preventDefault(); e.stopPropagation(); close(null); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); e.currentTarget.requestSubmit(); }
        if (e.key === 'Tab') {
          const controls = Array.from(form.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)') ?? []);
          const index = controls.indexOf(document.activeElement as HTMLElement);
          if (!controls.length) e.preventDefault();
          else if (e.shiftKey && index <= 0) { e.preventDefault(); controls.at(-1)?.focus(); }
          else if (!e.shiftKey && (index === controls.length - 1 || index < 0)) { e.preventDefault(); controls[0]?.focus(); }
        }
      }}
    >
      <div className={styles.modalHeader}>
        <div className={styles.headerTitle}>
          <Code size={16} color={`var(--node-${blockType})`} />
          <span>Редактирование блока: {displayTitle}</span>
        </div>
        <button
          type="button"
          className={styles.closeBtn}
          disabled={pending}
          onClick={() => close(null)}
          title="Закрыть (Esc)"
          aria-label="Закрыть окно редактирования"
        >
          <X size={16} />
        </button>
      </div>

      <div className={styles.modalBody}>
        <div className={styles.fieldGroup}>
          <div className={styles.codeMetaHeader}>
            <div className={styles.typeInfo}>
              <span className={styles.typeLabel}>Тип:</span>
              <span className={styles.typeValue}>{typeValue}</span>
            </div>
            {startLine !== undefined && (
              <div className={styles.lineInfo}>
                <span className={styles.lineLabel}>L:</span>
                <span className={styles.lineValue}>{startLine}</span>
              </div>
            )}
          </div>
          {node.data.description && <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0' }}>{node.data.description}</p>}
          {node.data.astKind === 'FieldDeclaration' && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>{node.data.displayCode}</pre>}
          <label className={styles.label} htmlFor="node-java-code" style={{ marginTop: 6 }}>{field}</label>
          <textarea
            ref={textarea}
            id="node-java-code"
            className={styles.textarea}
            rows={5}
            value={code}
            onChange={e => setCode(e.target.value)}
            disabled={pending || !editable}
            placeholder="Введите код на Java..."
            spellCheck={false}
          />
        </div>

        {!editable && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Этот блок меняется через вкладку «Код Java».</p>}
        {node.data.warning && <p style={{ fontSize: 12, color: 'var(--accent-orange)' }}>{node.data.warning}</p>}
        {error && <p ref={failure} tabIndex={-1} role="alert" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'var(--accent-red)', maxHeight: 160, overflow: 'auto', fontSize: 12 }}>{error}</p>}
      </div>

      <div className={styles.modalFooter}>
        <button
          type="button"
          className={styles.deleteBtn}
          disabled={pending || !supported.includes('deleteBlock')}
          onClick={async () => { await remove(node.id); close(null); }}
          title="Удалить блок"
        >
          <Trash2 size={14} />
          <span>Удалить</span>
        </button>

        <div className={styles.footerActions}>
          <button type="button" className={styles.cancelBtn} disabled={pending} onClick={() => close(null)}>
            Отмена
          </button>
          <button type="submit" className={styles.saveBtn} disabled={pending || !editable || !code.trim()}>
            <Check size={14} />
            <span>{pending ? 'Сохранение…' : 'Сохранить'}</span>
          </button>
        </div>
      </div>
    </form>
  );
}

export const NodeEditModal: React.FC = () => {
  const node = useProjectStore(s => s.editingNode);
  const close = useProjectStore(s => s.setEditingNode);
  const pending = useProjectStore(s => s.isLoading);

  if (!node) return null;

  return (
    <div
      className={styles.modalOverlay}
      onClick={() => { if (!pending) close(null); }}
      role="dialog"
      aria-modal="true"
      aria-label={`Редактирование блока: ${node.data.title}`}
    >
      <NodeEditForm key={node.id} node={node} />
    </div>
  );
};
