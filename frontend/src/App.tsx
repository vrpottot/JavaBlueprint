import { useEffect } from 'react';
import { useProjectStore } from './store/useProjectStore';
import { TopToolbar } from './components/layout/TopToolbar';
import { DockLayout } from './components/layout/DockLayout';
import { OptimizationModal } from './components/modals/OptimizationModal';
import { ImportJavaModal } from './components/modals/ImportJavaModal';
import { AddBlockModal } from './components/modals/AddBlockModal';
import { MethodModal } from './components/modals/MethodModal';
import styles from './App.module.scss';

export function App() {
  const initialize = useProjectStore((s) => s.initialize);
  const error = useProjectStore((s) => s.error);
  const theme = useProjectStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => { void initialize(); }, [initialize]);

  return (
    <div className={styles.appContainer} data-theme={theme}>
      {/* Top Application Toolbar */}
      <TopToolbar />
      {error && <div role="alert" style={{ padding: '8px 16px', color: 'var(--accent-red, #d14343)' }}>{error}</div>}

      {/* Main Adaptive Docking Layout */}
      <main className={styles.mainLayout}>
        <DockLayout />
      </main>

      {/* Interactive Global Modals */}
      <OptimizationModal />
      <ImportJavaModal />
      <AddBlockModal />
      <MethodModal />
    </div>
  );
}

export default App;
