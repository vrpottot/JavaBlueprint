import React, { useState, useEffect } from 'react';
import { X, Trash2, Check, Code } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import styles from './NodeEditModal.module.scss';

export const NodeEditModal: React.FC = () => {
  const editingNode = useProjectStore((s) => s.editingNode);
  const setEditingNode = useProjectStore((s) => s.setEditingNode);
  const updateNodeData = useProjectStore((s) => s.updateNodeData);
  const deleteNode = useProjectStore((s) => s.deleteNode);

  const [title, setTitle] = useState('');
  const [codeSnippet, setCodeSnippet] = useState('');
  const [description, setDescription] = useState('');
  const [badge, setBadge] = useState('');

  useEffect(() => {
    if (editingNode) {
      setTitle(editingNode.data.title || '');
      setCodeSnippet(editingNode.data.codeSnippet || '');
      setDescription(editingNode.data.description || '');
      setBadge(editingNode.data.badge || '');
    }
  }, [editingNode]);

  if (!editingNode) return null;

  const handleSave = () => {
    updateNodeData(editingNode.id, {
      title,
      codeSnippet,
      description,
      badge,
    });
  };

  const handleDelete = () => {
    deleteNode(editingNode.id);
    setEditingNode(null);
  };

  return (
    <div className={styles.modalOverlay} onClick={() => setEditingNode(null)}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.headerTitle}>
            <Code size={16} color="#4294F7" />
            <span>Редактирование блока: {editingNode.id}</span>
          </div>
          <button
            className={styles.closeBtn}
            onClick={() => setEditingNode(null)}
            title="Закрыть (Esc)"
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
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Краткое назначение шага"
            />
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button className={styles.deleteBtn} onClick={handleDelete} title="Удалить блок">
            <Trash2 size={14} />
            <span>Удалить</span>
          </button>

          <div className={styles.footerActions}>
            <button className={styles.cancelBtn} onClick={() => setEditingNode(null)}>
              Отмена
            </button>
            <button className={styles.saveBtn} onClick={handleSave}>
              <Check size={14} />
              <span>Сохранить</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
