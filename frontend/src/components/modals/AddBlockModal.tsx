import React, { useState } from 'react';
import {
  X,
  Plus,
  Code2,
  Box,
  GitFork,
  RefreshCw,
  CornerDownLeft,
  ShieldAlert,
  Terminal,
  Layers,
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { PALETTE_ITEMS, PALETTE_CATEGORIES } from '../../lib/palette';
import styles from './AddBlockModal.module.scss';

export const AddBlockModal: React.FC = () => {
  const showAddBlockModal = useProjectStore((s) => s.showAddBlockModal);
  const setShowAddBlockModal = useProjectStore((s) => s.setShowAddBlockModal);
  const addNode = useProjectStore((s) => s.addNode);

  const [activeCategory, setActiveCategory] = useState<string>('Все');
  const [selectedId, setSelectedId] = useState<string>(PALETTE_ITEMS[0]?.id ?? 'method');

  if (!showAddBlockModal) return null;

  const getIcon = (item: (typeof PALETTE_ITEMS)[number]) => {
    if (item.category === 'Исключения') {
      return <ShieldAlert size={16} color="var(--node-return)" />;
    }
    if (item.category === 'Консольный ввод-вывод') {
      return <Terminal size={16} color="var(--node-operation)" />;
    }
    if (item.category === 'Коллекции java.util') {
      return <Layers size={16} color="var(--node-operation)" />;
    }
    switch (item.type) {
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
      default:
        return <Plus size={16} color="var(--node-operation)" />;
    }
  };

  const displayedItems =
    activeCategory === 'Все'
      ? PALETTE_ITEMS
      : PALETTE_ITEMS.filter((item) => item.category === activeCategory);

  const handleAdd = () => {
    const selectedItem =
      PALETTE_ITEMS.find((p) => (p.id ?? p.name) === selectedId) ?? PALETTE_ITEMS[0];
    if (selectedItem) {
      void addNode(selectedItem.type, undefined, selectedItem.defaultCode);
    }
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
            <span id="add-block-title">Добавить визуальный блок Java</span>
          </div>
          <button
            className={styles.closeBtn}
            onClick={() => setShowAddBlockModal(false)}
            aria-label="Закрыть модальное окно"
          >
            <X size={16} />
          </button>
        </div>

        {/* Категории из спецификации Axenix */}
        <div className={styles.categoryTabs}>
          {PALETTE_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`${styles.tabBtn} ${activeCategory === cat ? styles.activeTab : ''}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className={styles.modalBody}>
          <div className={styles.blocksGrid}>
            {displayedItems.map((item) => {
              const itemId = item.id ?? item.name;
              const isSelected = selectedId === itemId;
              return (
                <div
                  key={itemId}
                  onClick={() => setSelectedId(itemId)}
                  onDoubleClick={handleAdd}
                  className={`${styles.blockCard} ${isSelected ? styles.selected : ''}`}
                >
                  <div className={styles.cardHeader}>
                    <div className={styles.cardHeaderLeft}>
                      {getIcon(item)}
                      <span className={styles.cardTitle}>{item.name}</span>
                    </div>
                    {item.category && (
                      <span className={styles.cardCategory}>{item.category}</span>
                    )}
                  </div>
                  <span className={styles.cardDesc}>{item.description}</span>
                  {item.defaultCode && (
                    <div className={styles.cardSnippet}>{item.defaultCode}</div>
                  )}
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
            <span>Добавить на схему</span>
          </button>
        </div>
      </div>
    </div>
  );
};
