import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type DockviewApi,
  type IDockviewHeaderActionsProps,
} from 'dockview-react';
import 'dockview/dist/styles/dockview.css';
import { Maximize2, Minimize2 } from 'lucide-react';
import { ProjectTreePanel, BlockPalettePanel } from './ProjectExplorer';
import { VisualCanvas } from '../graph/VisualCanvas';
import { JavaEditor } from '../editor/JavaEditor';
import { ConsolePanel } from '../console/ConsolePanel';
import { TestResults } from '../tests/TestResults';
import { AnalysisPanel } from './AnalysisPanel';
import { useProjectStore } from '../../store/useProjectStore';
import styles from './DockLayout.module.scss';

const HeaderActions: React.FC<IDockviewHeaderActionsProps> = ({ api }) => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const disposable = api.onDidActivePanelChange(() => {
      setIsMaximized(api.isMaximized());
    });
    return () => disposable.dispose();
  }, [api]);

  const toggleMaximize = useCallback(() => {
    if (api.isMaximized()) {
      api.exitMaximized();
      setIsMaximized(false);
    } else {
      api.maximize();
      setIsMaximized(true);
    }
  }, [api]);

  return (
    <div className={styles.headerActionsGroup}>
      <button
        className={styles.headerActionBtn}
        onClick={toggleMaximize}
        title={isMaximized ? 'Восстановить размер' : 'Развернуть во весь экран'}
        aria-label={isMaximized ? 'Восстановить размер' : 'Развернуть во весь экран'}
      >
        {isMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
      </button>
    </div>
  );
};

export const DockLayout: React.FC = () => {
  const theme = useProjectStore((s) => s.theme);
  const isLeftSidebarOpen = useProjectStore((s) => s.isLeftSidebarOpen);
  const isRightSidebarOpen = useProjectStore((s) => s.isRightSidebarOpen);
  const mainWorkspaceTab = useProjectStore((s) => s.mainWorkspaceTab);
  const bottomWorkspaceTab = useProjectStore((s) => s.bottomWorkspaceTab);

  const apiRef = useRef<DockviewApi | null>(null);
  const isInternalChangeRef = useRef(false);

  const components = useMemo(
    () => ({
      project_tree: (_props: IDockviewPanelProps) => <ProjectTreePanel />,
      block_palette: (_props: IDockviewPanelProps) => <BlockPalettePanel />,
      visual_canvas: (_props: IDockviewPanelProps) => <VisualCanvas />,
      java_editor: (_props: IDockviewPanelProps) => <JavaEditor />,
      console_panel: (_props: IDockviewPanelProps) => <ConsolePanel />,
      test_results: (_props: IDockviewPanelProps) => <TestResults />,
      analysis_panel: (_props: IDockviewPanelProps) => <AnalysisPanel />,
    }),
    []
  );

  const onReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api;

    // Try restoring saved layout from localStorage
    let isLayoutRestored = false;
    const DOCK_LAYOUT_KEY = 'javablueprint_dockview_layout_v6_normal_width';
    const savedLayoutStr = localStorage.getItem(DOCK_LAYOUT_KEY);
    if (savedLayoutStr) {
      try {
        const layoutObj = JSON.parse(savedLayoutStr);
        if (layoutObj && layoutObj.grid) {
          event.api.fromJSON(layoutObj);
          isLayoutRestored = true;
        }
      } catch (err) {
        console.warn('Failed to restore dockview layout from localStorage:', err);
      }
    }

    if (!isLayoutRestored || !event.api.getPanel('visual_canvas')) {
      event.api.clear();

      // 1. Center / Main Workspace: Flowchart / Visual Canvas
      const canvasPanel = event.api.addPanel({
        id: 'visual_canvas',
        component: 'visual_canvas',
        title: 'Блок-схема',
      });

      // 2. Center / Main Workspace: Java Code Editor (tabbed with flowchart)
      event.api.addPanel({
        id: 'java_editor',
        component: 'java_editor',
        title: 'Код Java',
        position: { direction: 'within', referencePanel: canvasPanel },
      });

      // 3. Right Sidebar: Code Analysis & AI (FULL HEIGHT OF PAGE & COMFORTABLE WIDTH)
      // Placed to the right of the grid root without referencePanel so it spans 100% height
      if (useProjectStore.getState().isRightSidebarOpen) {
        const analysisPanel = event.api.addPanel({
          id: 'analysis_panel',
          component: 'analysis_panel',
          title: 'Анализ кода',
          position: { direction: 'right' },
          initialWidth: 420,
        });
        analysisPanel.api.setSize({ width: 420 });
        analysisPanel.api.setConstraints({ minimumWidth: 350 });
      }

      // 4. Left Top: Project Tree
      if (useProjectStore.getState().isLeftSidebarOpen) {
        const projectPanel = event.api.addPanel({
          id: 'project_tree',
          component: 'project_tree',
          title: 'Проект',
          position: { direction: 'left', referencePanel: canvasPanel },
          initialWidth: 260,
        });
        projectPanel.api.setConstraints({ minimumWidth: 220 });

        // 5. Left Bottom: Block Palette
        event.api.addPanel({
          id: 'block_palette',
          component: 'block_palette',
          title: 'Блоки',
          position: { direction: 'below', referencePanel: projectPanel },
          initialHeight: 280,
        });
      }

      // 6. Bottom: Console (positioned strictly below canvasPanel, shifted to not go under AI panel)
      const consolePanel = event.api.addPanel({
        id: 'console_panel',
        component: 'console_panel',
        title: 'Консоль',
        position: { direction: 'below', referencePanel: canvasPanel },
        initialHeight: 240,
      });

      // 7. Bottom: Test Results (tabbed with console)
      event.api.addPanel({
        id: 'test_results',
        component: 'test_results',
        title: 'Результаты тестов',
        position: { direction: 'within', referencePanel: consolePanel },
      });

      // Set initial active tabs
      canvasPanel.api.setActive();
      consolePanel.api.setActive();
    } else {
      // Ensure restored layout has comfortable width constraints
      const restoredAnalysis = event.api.getPanel('analysis_panel');
      if (restoredAnalysis) {
        restoredAnalysis.api.setConstraints({ minimumWidth: 350 });
        if ((restoredAnalysis.api.width ?? 0) < 350) {
          restoredAnalysis.api.setSize({ width: 420 });
        }
      }
    }

    // Persist layout changes to localStorage
    let saveDebounce: ReturnType<typeof setTimeout> | undefined;
    const persistDockLayout = () => {
      clearTimeout(saveDebounce);
      saveDebounce = setTimeout(() => {
        try {
          if (apiRef.current) {
            const json = apiRef.current.toJSON();
            localStorage.setItem(DOCK_LAYOUT_KEY, JSON.stringify(json));
          }
        } catch (e) {
          console.warn('Failed to save dockview layout to localStorage:', e);
        }
      }, 400);
    };

    event.api.onDidLayoutChange(() => {
      persistDockLayout();
    });

    // Sync active tab clicks with store
    event.api.onDidActivePanelChange((event) => {
      const panel = event.panel;
      if (isInternalChangeRef.current || !panel) return;
      if (panel.id === 'visual_canvas') {
        useProjectStore.setState({ mainWorkspaceTab: 'graph' });
      } else if (panel.id === 'java_editor') {
        useProjectStore.setState({ mainWorkspaceTab: 'editor' });
      } else if (panel.id === 'console_panel') {
        useProjectStore.setState({ bottomWorkspaceTab: 'console' });
      } else if (panel.id === 'test_results') {
        useProjectStore.setState({ bottomWorkspaceTab: 'tests' });
      }
    });

    // Sync dockview panel close/remove events with store state
    event.api.onDidRemovePanel((panel) => {
      if (isInternalChangeRef.current) return;
      if (panel.id === 'project_tree' || panel.id === 'block_palette') {
        const hasTree = !!event.api.getPanel('project_tree');
        const hasPalette = !!event.api.getPanel('block_palette');
        if (!hasTree && !hasPalette && useProjectStore.getState().isLeftSidebarOpen) {
          useProjectStore.setState({ isLeftSidebarOpen: false });
        }
      } else if (panel.id === 'analysis_panel') {
        if (useProjectStore.getState().isRightSidebarOpen) {
          useProjectStore.setState({ isRightSidebarOpen: false });
        }
      }
    });
  }, []);

  // Sync toolbar toggle for left sidebar
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;

    const treePanel = api.getPanel('project_tree');
    const blocksPanel = api.getPanel('block_palette');

    if (isLeftSidebarOpen && !treePanel) {
      isInternalChangeRef.current = true;
      const refPanel = api.getPanel('visual_canvas') || api.panels[0];
      const newTree = api.addPanel({
        id: 'project_tree',
        component: 'project_tree',
        title: 'Проект',
        position: refPanel ? { direction: 'left', referencePanel: refPanel } : undefined,
        initialWidth: 260,
      });
      if (!blocksPanel) {
        api.addPanel({
          id: 'block_palette',
          component: 'block_palette',
          title: 'Блоки',
          position: { direction: 'below', referencePanel: newTree },
          initialHeight: 280,
        });
      }
      isInternalChangeRef.current = false;
    } else if (!isLeftSidebarOpen && (treePanel || blocksPanel)) {
      isInternalChangeRef.current = true;
      if (treePanel) api.removePanel(treePanel);
      if (blocksPanel) api.removePanel(blocksPanel);
      isInternalChangeRef.current = false;
    }
  }, [isLeftSidebarOpen]);

  // Sync toolbar toggle for right sidebar
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;

    const panel = api.getPanel('analysis_panel');
    if (isRightSidebarOpen && !panel) {
      isInternalChangeRef.current = true;
      const newPanel = api.addPanel({
        id: 'analysis_panel',
        component: 'analysis_panel',
        title: 'Анализ кода',
        position: { direction: 'right' },
        initialWidth: 420,
      });
      newPanel.api.setSize({ width: 420 });
      newPanel.api.setConstraints({ minimumWidth: 350 });
      isInternalChangeRef.current = false;
    } else if (!isRightSidebarOpen && panel) {
      isInternalChangeRef.current = true;
      api.removePanel(panel);
      isInternalChangeRef.current = false;
    }
  }, [isRightSidebarOpen]);

  // Sync mainWorkspaceTab from store to dockview
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;

    if (mainWorkspaceTab === 'editor') {
      const panel = api.getPanel('java_editor');
      if (panel) {
        isInternalChangeRef.current = true;
        panel.api.setActive();
        isInternalChangeRef.current = false;
      }
    } else if (mainWorkspaceTab === 'graph') {
      const panel = api.getPanel('visual_canvas');
      if (panel) {
        isInternalChangeRef.current = true;
        panel.api.setActive();
        isInternalChangeRef.current = false;
      }
    }
  }, [mainWorkspaceTab]);

  // Sync bottomWorkspaceTab from store to dockview
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;

    if (bottomWorkspaceTab === 'console') {
      const panel = api.getPanel('console_panel');
      if (panel) {
        isInternalChangeRef.current = true;
        panel.api.setActive();
        isInternalChangeRef.current = false;
      }
    } else if (bottomWorkspaceTab === 'tests') {
      const panel = api.getPanel('test_results');
      if (panel) {
        isInternalChangeRef.current = true;
        panel.api.setActive();
        isInternalChangeRef.current = false;
      }
    }
  }, [bottomWorkspaceTab]);

  const themeClass = theme === 'dark' ? 'dockview-theme-dark' : 'dockview-theme-light';

  return (
    <div className={`${styles.dockLayoutWrapper} ${themeClass}`}>
      <DockviewReact
        className={themeClass}
        components={components}
        rightHeaderActionsComponent={HeaderActions}
        onReady={onReady}
      />
    </div>
  );
};
