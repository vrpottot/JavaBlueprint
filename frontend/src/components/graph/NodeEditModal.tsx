import React, { useEffect, useRef, useState } from 'react';
import { X, Trash2, Check, Code } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import type { Node } from '@xyflow/react';
import type { VisualBlockData } from '../../types';
import styles from './NodeEditModal.module.scss';

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
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; textarea.current?.focus(); return () => { if(previous?.isConnected) previous.focus(); }; }, []);
  useEffect(() => { if (error) failure.current?.focus(); }, [error]);
  useEffect(() => { if(pending) form.current?.focus(); }, [pending]);
  return <form ref={form} tabIndex={-1} aria-busy={pending} className={styles.modalContent} onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); if (editable && !pending) void save(node.id, { codeSnippet: code }); }} onKeyDown={e => {
    if (e.key === 'Escape' && !pending) { e.preventDefault(); e.stopPropagation(); close(null); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); e.currentTarget.requestSubmit(); }
    if(e.key === 'Tab') {
      const controls = Array.from(form.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)') ?? []);
      const index = controls.indexOf(document.activeElement as HTMLElement);
      if (!controls.length) e.preventDefault();
      else if(e.shiftKey && index<=0) { e.preventDefault(); controls.at(-1)?.focus(); }
      else if(!e.shiftKey && (index===controls.length-1 || index<0)) { e.preventDefault(); controls[0]?.focus(); }
    }
  }}>
    <div className={styles.modalHeader}>
      <div className={styles.headerTitle}><Code size={16} color="var(--accent-blue)" /><span>Редактирование блока: {node.data.title}</span></div>
      <button type="button" className={styles.closeBtn} disabled={pending} onClick={() => close(null)} aria-label="Закрыть окно редактирования"><X size={16} /></button>
    </div>
    <div className={styles.modalBody}>
      <p>{node.data.description}</p>
      {node.data.astKind === 'FieldDeclaration' && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{node.data.displayCode}</pre>}
      <div className={styles.fieldGroup}>
        <label className={styles.label} htmlFor="node-java-code">{field}</label>
        <textarea ref={textarea} id="node-java-code" className={styles.textarea} rows={6} value={code} onChange={e => setCode(e.target.value)} disabled={pending || !editable} spellCheck={false} />
      </div>
      {!editable && <p>Этот блок меняется через вкладку «Код Java».</p>}
      {node.data.warning && <p>{node.data.warning}</p>}
      <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Сохранение проверяет синтаксис. Кнопка Run проверяет компиляцию и тесты.</p>
      {error && <p ref={failure} tabIndex={-1} role="alert" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: 'var(--accent-red)', maxHeight: 160, overflow: 'auto' }}>{error}</p>}
    </div>
    <div className={styles.modalFooter}>
      <button type="button" className={styles.deleteBtn} disabled={pending || !supported.includes('deleteBlock')} onClick={async () => { await remove(node.id); }}><Trash2 size={14} /><span>Удалить</span></button>
      <div className={styles.footerActions}>
        <button type="button" className={styles.cancelBtn} disabled={pending} onClick={() => close(null)}>Отмена</button>
        <button type="submit" className={styles.saveBtn} disabled={pending || !editable || !code.trim()}><Check size={14} /><span>{pending ? 'Сохранение…' : 'Сохранить'}</span></button>
      </div>
    </div>
  </form>;
}

export const NodeEditModal: React.FC = () => {
  const node = useProjectStore(s => s.editingNode);
  const close = useProjectStore(s => s.setEditingNode);
  const pending = useProjectStore(s => s.isLoading);
  if (!node) return null;
  return <div className={styles.modalOverlay} onClick={() => { if (!pending) close(null); }} role="dialog" aria-modal="true" aria-label={`Редактирование блока: ${node.data.title}`}><NodeEditForm key={node.id} node={node} /></div>;
};
