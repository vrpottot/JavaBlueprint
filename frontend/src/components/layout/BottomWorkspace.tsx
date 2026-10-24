import React, { useState, useEffect, useCallback } from 'react';
import { Terminal, CheckCircle2 } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { ConsolePanel } from '../console/ConsolePanel';
import { TestResults } from '../tests/TestResults';
import styles from './BottomWorkspace.module.scss';

export const BottomWorkspace: React.FC = () => {
  const bottomPanelHeight = useProjectStore((s) => s.bottomPanelHeight);
  const setBottomPanelHeight = useProjectStore((s) => s.setBottomPanelHeight);

  const [activeTab, setActiveTab] = useState<'console' | 'tests'>('console');
  const [isResizing, setIsResizing] = useState(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;
      const newHeight = window.innerHeight - e.clientY;
      if (newHeight >= 120 && newHeight <= window.innerHeight - 150) {
        setBottomPanelHeight(newHeight);
      }
    },
    [isResizing, setBottomPanelHeight]
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  return (
    <section className={styles.workspace} style={{ height: `${bottomPanelHeight}px` }}>
      {/* Draggable Height Resizer */}
      <div
        className={`${styles.resizeHandle} ${isResizing ? styles.active : ''}`}
        onMouseDown={handleMouseDown}
        title="Перетащите для изменения высоты"
      />

      {/* Tabs Header matching reference screenshot */}
      <div className={styles.tabBar}>
        <div className={styles.tabsGroup}>
          <button
            className={`${styles.tabBtn} ${activeTab === 'console' ? styles.active : ''}`}
            onClick={() => setActiveTab('console')}
          >
            <Terminal size={14} className={styles.tabIcon} />
            <span>Консоль</span>
          </button>

          <button
            className={`${styles.tabBtn} ${activeTab === 'tests' ? styles.active : ''}`}
            onClick={() => setActiveTab('tests')}
          >
            <CheckCircle2 size={14} className={styles.tabIcon} />
            <span>Результат тестов</span>
          </button>
        </div>
      </div>

      {/* Tab Panels */}
      <div className={styles.tabContentArea}>
        {activeTab === 'console' && <ConsolePanel />}
        {activeTab === 'tests' && <TestResults />}
      </div>
    </section>
  );
};
