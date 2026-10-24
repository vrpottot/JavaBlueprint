import React, { useState } from 'react';
import { X, Trash2, Check, Code } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import type { Node } from '@xyflow/react';
import type { VisualBlockData } from '../../types';
import styles from './NodeEditModal.module.scss';

interface NodeEditFormProps {
  node: Node<VisualBlockData>;
  onClose: () => void;
  onSave: (data: Partial<VisualBlockData>) => void;
  onDelete: () => void;
}

const NodeEditForm: React.FC<NodeEditFormProps> = ({ node, onClose, onSave, onDelete }) => {
  const [title, setTitle] = useState(node.data.title || '');
  const [codeSnippet, setCodeSnippet] = useState(node.data.codeSnippet || '');
  const [description, setDescription] = useState(node.data.description || '');
  const [badge, setBadge] = useState(node.data.badge || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ title, codeSnippet, description, badge });
  };

  return (
    <form className={styles.modalContent} onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
      <div className={styles.modalHeader}>
        <div className={styles.headerTitle}>
          <Code size={16} color="var(--accent-blue)" />
          <span>Редактирование блока: {node.data.title || node.id}</span>
        </div>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          title="Закрыть (Esc)"
          aria-label="Закрыть окно редактирования"
        >
          <X size={16} />
        </button>
      </div>

      <div className={styles.modalBody}>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Заголовок блока</label>
          <input
            type="text"
            className={styles.input}
            value={title}
            readOnly
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Название действия или условия"
          />
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>Java-выражение (Код)</label>
          <textarea
            className={styles.textarea}
            rows={4}
            value={codeSnippet}
            onChange={(e) => setCodeSnippet(e.target.value)}
            placeholder="order != null && validator.isValid(order)"
          />
        </div>

        <div className={styles.row}>
          <div className={styles.fieldGroup} style={{ flex: 1 }}>
            <label className={styles.label}>Бейдж / Тип</label>
            <input
              type="text"
              className={styles.input}
              value={badge}
              readOnly
              onChange={(e) => setBadge(e.target.value)}
              placeholder="boolean, List<Order>, etc."
            />
          </div>
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label}>Пояснение / Описание</label>
          <input
            type="text"
            className={styles.input}
            value={description}
            readOnly
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Краткое назначение шага"
          />
        </div>
      </div>

      <div className={styles.modalFooter}>
        <button type="button" className={styles.deleteBtn} onClick={onDelete} title="Удалить блок">
          <Trash2 size={14} />
          <span>Удалить</span>
        </button>

        <div className={styles.footerActions}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className={styles.saveBtn}>
            <Check size={14} />
            <span>Сохранить</span>
          </button>
        </div>
      </div>
    </form>
  );
};

export const NodeEditModal: React.FC = () => {
  const editingNode = useProjectStore((s) => s.editingNode);
  const setEditingNode = useProjectStore((s) => s.setEditingNode);
  const updateNodeData = useProjectStore((s) => s.updateNodeData);
  const deleteNode = useProjectStore((s) => s.deleteNode);

  if (!editingNode) return null;

  return (
    <div
      className={styles.modalOverlay}
      onClick={() => setEditingNode(null)}
      role="dialog"
      aria-modal="true"
    >
      <NodeEditForm
        key={editingNode.id}
        node={editingNode}
        onClose={() => setEditingNode(null)}
        onSave={(data) => updateNodeData(editingNode.id, data)}
        onDelete={() => {
          deleteNode(editingNode.id);
          setEditingNode(null);
        }}
      />
    </div>
  );
};
