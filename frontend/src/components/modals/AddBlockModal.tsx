import React, { useState } from 'react';
import { X, Plus, Code, Database, GitFork, RefreshCw, PlayCircle, CheckCircle2 } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { PALETTE_ITEMS } from '../../lib/demo-data';
import type { BlockType } from '../../types';
import styles from './ImportJavaModal.module.scss';

export const AddBlockModal: React.FC = () => {
  const showAddBlockModal = useProjectStore((s) => s.showAddBlockModal);
  const setShowAddBlockModal = useProjectStore((s) => s.setShowAddBlockModal);
  const addNode = useProjectStore((s) => s.addNode);

  const [selectedType, setSelectedType] = useState<BlockType>('operation');

  if (!showAddBlockModal) return null;

  const getIcon = (type: BlockType) => {
    switch (type) {
      case 'method':
        return <Code size={16} color="#A879F8" />;
      case 'variable':
        return <Database size={16} color="#4294F7" />;
      case 'condition':
        return <GitFork size={16} color="#F4A34B" />;
      case 'loop':
        return <RefreshCw size={16} color="#A879F8" />;
      case 'operation':
        return <PlayCircle size={16} color="#388BFD" />;
      case 'return':
        return <CheckCircle2 size={16} color="#39C98A" />;
    }
  };

  const handleAdd = () => {
    addNode(selectedType);
  };

  return (
    <div className={styles.modalOverlay} onClick={() => setShowAddBlockModal(false)}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Plus size={16} color="#39C98A" />
            <span>Добавить новый визуальный блок</span>
          </div>
          <button className={styles.closeBtn} onClick={() => setShowAddBlockModal(false)}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.modalBody}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
            {PALETTE_ITEMS.map((item) => {
              const isSelected = selectedType === item.type;
              return (
                <div
                  key={item.type}
                  onClick={() => setSelectedType(item.type)}
                  style={{
                    backgroundColor: isSelected ? '#1B2533' : '#151D29',
                    border: `1px solid ${isSelected ? item.color : '#2A3647'}`,
                    borderRadius: '6px',
                    padding: '10px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {getIcon(item.type)}
                    <span style={{ fontWeight: 600, fontSize: '12px', color: '#E6EDF7' }}>
                      {item.name}
                    </span>
                  </div>
                  <span style={{ fontSize: '10.5px', color: '#8D9BAF' }}>{item.description}</span>
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
