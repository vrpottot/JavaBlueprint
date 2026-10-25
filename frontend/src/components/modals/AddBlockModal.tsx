import React, { useState } from 'react';
import { X, Plus, Code2, Box, GitFork, RefreshCw, CornerDownLeft } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { PALETTE_ITEMS } from '../../lib/palette';
import type { BlockType } from '../../types';
import styles from './AddBlockModal.module.scss';

export const AddBlockModal: React.FC = () => {
  const showAddBlockModal = useProjectStore((s) => s.showAddBlockModal);
  const setShowAddBlockModal = useProjectStore((s) => s.setShowAddBlockModal);
  const addNode = useProjectStore((s) => s.addNode);

  const [selectedType, setSelectedType] = useState<BlockType>('operation');

  if (!showAddBlockModal) return null;

  const getIcon = (type: BlockType) => {
    switch (type) {
      case 'method':
        return <Code2 size={16} color="var(--node-method)" />;
      case 'variable':
        return <Box size={16} color="var(--node-variable)" />;
      case 'condition':
        return <GitFork size={16} color="var(--node-condition)" />;
      case 'loop':
        return <RefreshCw size={16} color="var(--node-loop)" />;
      case 'operation':
        return <Plus size={16} color="var(--node-operation)" />;
      case 'return':
        return <CornerDownLeft size={16} color="var(--node-return)" />;
    }
  };

  const handleAdd = () => {
    addNode(selectedType);
    setShowAddBlockModal(false);
  };

  return (
    <div
      className={styles.modalOverlay}
      onClick={() => setShowAddBlockModal(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-block-title"
    >
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.headerLeft}>
            <Plus size={16} className={styles.headerIcon} />
            <span id="add-block-title">Добавить новый визуальный блок</span>
          </div>
          <button
            className={styles.closeBtn}
            onClick={() => setShowAddBlockModal(false)}
            aria-label="Закрыть модальное окно"
          >
            <X size={16} />
          </button>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.blocksGrid}>
            {PALETTE_ITEMS.map((item) => {
              const isSelected = selectedType === item.type;
              return (
                <div
                  key={item.type}
                  onClick={() => setSelectedType(item.type)}
                  className={`${styles.blockCard} ${isSelected ? styles.selected : ''}`}
                >
                  <div className={styles.cardHeader}>
                    {getIcon(item.type)}
                    <span className={styles.cardTitle}>{item.name}</span>
                  </div>
                  <span className={styles.cardDesc}>{item.description}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button className={styles.cancelBtn} onClick={() => setShowAddBlockModal(false)}>
            Отмена
          </button>
          <button className={styles.submitBtn} onClick={handleAdd}>
            <Plus size={14} />
            <span>Добавить на canvas</span>
          </button>
        </div>
      </div>
    </div>
  );
};
