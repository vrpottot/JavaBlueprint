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
import styles from './App.module.scss';

export function App() {
  const theme = useProjectStore((s) => s.theme);
  const isLeftSidebarOpen = useProjectStore((s) => s.isLeftSidebarOpen);
  const toggleLeftSidebar = useProjectStore((s) => s.toggleLeftSidebar);
  const isRightSidebarOpen = useProjectStore((s) => s.isRightSidebarOpen);
  const toggleRightSidebar = useProjectStore((s) => s.toggleRightSidebar);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <div className={styles.appContainer} data-theme={theme}>
      {/* Top Application Toolbar */}
      <TopToolbar />

      {/* Main Workspace: Left Sidebar, Visual Canvas, Right Sidebar */}
      <main className={styles.mainLayout}>
        {isLeftSidebarOpen ? (
          <ProjectExplorer />
        ) : (
          <div
            className={styles.collapsedTrigger}
            onClick={toggleLeftSidebar}
            title="Развернуть проводник проекта"
          >
            <span className={styles.verticalText}>Проект</span>
          </div>
        )}

        <div className={styles.centerArea}>
          <VisualCanvas />
        </div>

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

      {/* Bottom Workspace: Java Code Editor, Console, Tests */}
      <BottomWorkspace />

      {/* Interactive Global Modals */}
      <OptimizationModal />
      <ImportJavaModal />
      <AddBlockModal />
    </div>
  );
}

export default App;
