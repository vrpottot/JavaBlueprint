import { useEffect } from 'react';
import { useProjectStore } from './store/useProjectStore';
import { TopToolbar } from './components/layout/TopToolbar';
import { ProjectExplorer } from './components/layout/ProjectExplorer';
import { VisualCanvas } from './components/graph/VisualCanvas';
import { AnalysisPanel } from './components/layout/AnalysisPanel';
import { BottomWorkspace } from './components/layout/BottomWorkspace';
import { OptimizationModal } from './components/modals/OptimizationModal';
import { ImportJavaModal } from './components/modals/ImportJavaModal';
import { AddBlockModal } from './components/modals/AddBlockModal';
import { MethodModal } from './components/modals/MethodModal';
import styles from './App.module.scss';

export function App() {
  const initialize = useProjectStore((s) => s.initialize);
  const error = useProjectStore((s) => s.error);
  const theme = useProjectStore((s) => s.theme);
  const isLeftSidebarOpen = useProjectStore((s) => s.isLeftSidebarOpen);
  const toggleLeftSidebar = useProjectStore((s) => s.toggleLeftSidebar);
  const isRightSidebarOpen = useProjectStore((s) => s.isRightSidebarOpen);
  const toggleRightSidebar = useProjectStore((s) => s.toggleRightSidebar);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => { void initialize(); }, [initialize]);

  return (
    <div className={styles.appContainer} data-theme={theme}>
      {/* Top Application Toolbar */}
      <TopToolbar />
      {error && <div role="alert" style={{ padding: '8px 16px', color: 'var(--accent-red, #d14343)' }}>{error}</div>}

      {/* Main Workspace Layout */}
      <main className={styles.mainLayout}>
        {/* Left Sidebar (Full height from top toolbar to bottom of window) */}
        {isLeftSidebarOpen ? (
          <ProjectExplorer />
        ) : (
          <div
            className={styles.collapsedTrigger}
            onClick={toggleLeftSidebar}
            title="Развернуть проводник проекта (Ctrl+B)"
          >
            <span className={styles.verticalText}>Проект</span>
          </div>
        )}

        {/* Center Area: Visual Flow Canvas (top) + Tabbed Bottom Workspace (bottom) */}
        <div className={styles.centerArea}>
          <VisualCanvas />
          <BottomWorkspace />
        </div>

        {/* Right Sidebar: Code Analysis & Metrics */}
        {isRightSidebarOpen ? (
          <AnalysisPanel />
        ) : (
          <div
            className={`${styles.collapsedTrigger} ${styles.right}`}
            onClick={toggleRightSidebar}
            title="Развернуть анализ кода"
          >
            <span className={styles.verticalText}>Анализ</span>
          </div>
        )}
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
