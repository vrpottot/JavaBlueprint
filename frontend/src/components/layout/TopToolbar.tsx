import { useState } from 'react';
import {
  Sidebar,
  Layers,
  Upload,
  Download,
  Play,
  Plus,
  ChevronDown,
  Settings,
  Moon,
  Sun,
  Bug,
  RotateCcw,
  SlidersHorizontal,
  ChevronRight,
  Terminal,
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import styles from './TopToolbar.module.scss';

export const TopToolbar: React.FC = () => {
  const theme = useProjectStore((s) => s.theme);
  const toggleTheme = useProjectStore((s) => s.toggleTheme);
  const isLeftSidebarOpen = useProjectStore((s) => s.isLeftSidebarOpen);
  const toggleLeftSidebar = useProjectStore((s) => s.toggleLeftSidebar);
  const isRightSidebarOpen = useProjectStore((s) => s.isRightSidebarOpen);
  const toggleRightSidebar = useProjectStore((s) => s.toggleRightSidebar);
  const projectName = useProjectStore((s) => s.projectName);
  const activeFilePath = useProjectStore((s) => s.activeFilePath);
  const isOptimized = useProjectStore((s) => s.isOptimized);
  const isRunning = useProjectStore((s) => s.isRunning);
  const isCompiling = useProjectStore((s) => s.isCompiling);

  const setShowOptimizationModal = useProjectStore((s) => s.setShowOptimizationModal);
  const revertOptimization = useProjectStore((s) => s.revertOptimization);
  const setShowImportModal = useProjectStore((s) => s.setShowImportModal);
  const setShowAddBlockModal = useProjectStore((s) => s.setShowAddBlockModal);
  const exportJavaFile = useProjectStore((s) => s.exportJavaFile);
  const runProgram = useProjectStore((s) => s.runProgram);

  const [runDropdownOpen, setRunDropdownOpen] = useState(false);

  return (
    <header className={styles.toolbar}>
      {/* Left: Sidebar toggle, Logo with subtitle, Project info */}
      <div className={styles.leftSection}>
        <button
          className={`${styles.iconButton} ${isLeftSidebarOpen ? styles.active : ''}`}
          onClick={toggleLeftSidebar}
          title="Свернуть / Развернуть проводник проекта"
        >
          <Sidebar size={16} />
        </button>

        <div className={styles.brand} title="JavaScope: Understand. Transform. Verify.">
          <div className={styles.brandLogo}>
            <Layers size={14} />
          </div>
          <div className={styles.brandTextGroup}>
            <span className={styles.brandTitle}>Visual Programming Environment</span>
            <span className={styles.brandSubtitle}>JAVA BLUEPRINTS</span>
          </div>
        </div>

        <div className={styles.projectInfo}>
          <span className={styles.projectName}>{projectName}</span>
          <span style={{ color: 'var(--text-muted)' }}>/</span>
          <div className={styles.filePath}>
            <span style={{ color: 'var(--text-primary)' }}>{activeFilePath.split('/').pop()}</span>
            <ChevronRight size={12} color="var(--text-muted)" />
            <span style={{ color: 'var(--text-secondary)' }}>processOrders()</span>
          </div>
        </div>
      </div>

      {/* Center/Right Actions matching reference image */}
      <div className={styles.centerSection}>
        <button
          className={styles.toolbarBtn}
          onClick={() => setShowImportModal(true)}
          title="Импортировать .java файл в проект"
        >
          <Upload size={14} />
          <span>Import Java</span>
        </button>

        <button
          className={styles.toolbarBtn}
          onClick={exportJavaFile}
          title="Экспортировать текущий файл на компьютер"
        >
          <Download size={14} />
          <span>Export Java</span>
        </button>

        <div className={styles.divider} />

        {/* Optimize button (Vibrant orange button with Play/Sparkle) */}
        {!isOptimized ? (
          <button
            className={styles.optimizeBtn}
            onClick={() => setShowOptimizationModal(true)}
            title="Автоматическая оптимизация алгоритма и снижение сложности"
          >
            <Play size={13} fill="currentColor" />
            <span>Optimize</span>
          </button>
        ) : (
          <button
            className={`${styles.optimizeBtn} ${styles.revert}`}
            onClick={revertOptimization}
            title="Вернуться к исходному коду"
          >
            <RotateCcw size={13} />
            <span>Исходный код</span>
          </button>
        )}

        {/* Run button group */}
        <div className={styles.runGroup} style={{ position: 'relative' }}>
          <button
            className={`${styles.runBtn} ${isRunning || isCompiling ? styles.running : ''}`}
            onClick={runProgram}
            disabled={isRunning || isCompiling}
            title="Запустить программу"
          >
            <Play size={14} />
            <span>{isCompiling ? 'Компиляция...' : isRunning ? 'Выполнение...' : 'Run'}</span>
          </button>
          <button
            className={styles.runDropdownBtn}
            onClick={() => setRunDropdownOpen(!runDropdownOpen)}
            title="Конфигурация запуска"
          >
            <ChevronDown size={13} />
          </button>

          {runDropdownOpen && (
            <div
              style={{
                position: 'absolute',
                top: '34px',
                right: 0,
                backgroundColor: 'var(--bg-panel)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                padding: '4px',
                minWidth: '220px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                zIndex: 100,
              }}
              onClick={() => setRunDropdownOpen(false)}
            >
              <div
                style={{
                  padding: '6px 10px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: 'var(--text-primary)',
                }}
                onClick={runProgram}
              >
                <Play size={13} color="var(--accent-green)" />
                <span>Запуск с бенчмарком</span>
              </div>
              <div
                style={{
                  padding: '6px 10px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: 'var(--text-secondary)',
                }}
                onClick={runProgram}
              >
                <Terminal size={13} />
                <span>Профилирование ForkJoinPool</span>
              </div>
            </div>
          )}
        </div>

        {/* Debug button */}
        <button
          className={styles.toolbarBtn}
          onClick={runProgram}
          title="Запуск в режиме отладки"
        >
          <Bug size={14} />
          <span>Debug</span>
        </button>

        <button
          className={styles.toolbarBtn}
          onClick={() => setShowAddBlockModal(true)}
          title="Добавить новый блок на холст"
        >
          <Plus size={14} color="var(--accent-blue)" />
          <span>Добавить блок</span>
        </button>
      </div>

      {/* Right: Settings, Theme Toggle, Analysis Sidebar Toggle */}
      <div className={styles.rightSection}>
        <button
          className={`${styles.iconButton} ${isRightSidebarOpen ? styles.active : ''}`}
          onClick={toggleRightSidebar}
          title="Панель статического анализа кода"
        >
          <SlidersHorizontal size={15} />
        </button>

        {/* Theme Toggle Button */}
        <button
          className={styles.iconButton}
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Переключить на светлую тему' : 'Переключить на тёмную тему'}
        >
          {theme === 'dark' ? <Sun size={15} color="#F4A34B" /> : <Moon size={15} color="#475569" />}
        </button>

        <button className={styles.iconButton} title="Настройки среды JavaScope">
          <Settings size={15} />
        </button>
      </div>
    </header>
  );
};
