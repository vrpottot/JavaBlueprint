import React, { useRef, useEffect } from 'react';
import { Terminal, Trash2 } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import styles from './ConsolePanel.module.scss';

export const ConsolePanel: React.FC = () => {
  const consoleLogs = useProjectStore((s) => s.consoleLogs);
  const clearConsole = useProjectStore((s) => s.clearConsole);
  const isRunning = useProjectStore((s) => s.isRunning);
  const isCompiling = useProjectStore((s) => s.isCompiling);

  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [consoleLogs]);

  return (
    <div className={styles.consoleContainer}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span
            className={`${styles.statusIndicator} ${
              isRunning || isCompiling ? styles.busy : ''
            }`}
          />
          <Terminal size={13} color="#4294F7" />
          <span>Консоль</span>
        </div>

        <div className={styles.headerRight}>
          <button className={styles.clearBtn} onClick={clearConsole} title="Очистить консоль">
            <Trash2 size={12} />
            <span>Очистить</span>
          </button>
        </div>
      </div>

      <div className={styles.logList} ref={listRef}>
        {consoleLogs.length === 0 ? (
          <div className={styles.emptyState}>Консоль пуста. Нажмите «Запуск» для выполнения.</div>
        ) : (
          consoleLogs.map((log) => (
            <div key={log.id} className={`${styles.logEntry} ${styles[log.type]}`}>
              <span className={styles.timestamp}>[{log.timestamp}]</span>
              <span className={styles.message}>{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
