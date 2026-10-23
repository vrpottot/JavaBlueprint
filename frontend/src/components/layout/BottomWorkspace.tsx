import React, { useState, useEffect, useCallback } from 'react';
import { useProjectStore } from '../../store/useProjectStore';
import { JavaEditor } from '../editor/JavaEditor';
import { ConsolePanel } from '../console/ConsolePanel';
import { TestResults } from '../tests/TestResults';
import styles from './BottomWorkspace.module.scss';

export const BottomWorkspace: React.FC = () => {
  const bottomPanelHeight = useProjectStore((s) => s.bottomPanelHeight);
  const setBottomPanelHeight = useProjectStore((s) => s.setBottomPanelHeight);

  const [isResizing, setIsResizing] = useState(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;
      const newHeight = window.innerHeight - e.clientY;
      setBottomPanelHeight(newHeight);
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
      <div
        className={`${styles.resizeHandle} ${isResizing ? styles.active : ''}`}
        onMouseDown={handleMouseDown}
        title="Перетащите для изменения высоты нижней рабочей области"
      />

      <div className={styles.columns}>
        <JavaEditor />
        <ConsolePanel />
        <TestResults />
      </div>
    </section>
  );
};
