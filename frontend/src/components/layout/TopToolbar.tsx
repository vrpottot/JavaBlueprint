import React, { useState, useRef, useEffect } from 'react';
import {
  Upload,
  Download,
  Play,
  ChevronDown,
  Settings,
  Moon,
  Sun,
  Bug,
  RotateCcw,
  SlidersHorizontal,
  ChevronRight,
  Terminal,
  Activity,
  Sparkles,
  FileText,
  Sidebar,
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
  const exportJavaFile = useProjectStore((s) => s.exportJavaFile);
  const runProgram = useProjectStore((s) => s.runProgram);

  const [runDropdownOpen, setRunDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setRunDropdownOpen(false);
      }
    };
    if (runDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [runDropdownOpen]);

  const fileName = activeFilePath.split('/').pop() || 'OrderService.java';

  return (
    <header className={styles.toolbar}>
      {/* Left side: Sidebar Toggle + Breadcrumb (Project > [File + Method Pill]) */}
      <div className={styles.leftGroup}>
        <button
          className={`${styles.iconBtn} ${isLeftSidebarOpen ? styles.active : ''}`}
          onClick={toggleLeftSidebar}
          title="Свернуть / Развернуть проводник (Ctrl+B)"
          aria-label="Toggle explorer sidebar"
        >
          <Sidebar size={15} />
        </button>

        <div className={styles.breadcrumb}>
          <span className={styles.projectName}>{projectName || 'OrderProcessingService'}</span>
          <ChevronRight size={13} className={styles.chevron} />
          <div className={styles.fileMethodPill}>
            <FileText size={14} className={styles.fileIcon} />
            <span className={styles.fileName}>{fileName}</span>
            <span className={styles.methodBadge}>processOrders()</span>
          </div>
        </div>
      </div>

      {/* Actions: Import, Export, Divider, Optimize, Run/Dropdown, Debug, Add Block */}
      <div className={styles.actionsGroup}>
        <button
          className={styles.actionBtn}
          onClick={() => setShowImportModal(true)}
          title="Импортировать .java файл"
        >
          <Upload size={13} />
          <span>Импорт</span>
        </button>

        <button
          className={styles.actionBtn}
          onClick={exportJavaFile}
          title="Экспортировать текущий файл"
        >
          <Download size={13} />
          <span>Экспорт</span>
        </button>

        <div className={styles.vDivider} />

        {/* Optimize button (Solid Orange filled button matching screenshot) */}
        {!isOptimized ? (
          <button
            className={styles.optimizeBtn}
            onClick={() => setShowOptimizationModal(true)}
            title="Автоматическая оптимизация алгоритма O(N²) -> O(N)"
          >
            <Sparkles size={13} />
            <span>Оптимизировать</span>
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

        {/* Run button with unified dropdown */}
        <div className={styles.runGroup} ref={dropdownRef}>
          <button
            className={`${styles.runBtn} ${isRunning || isCompiling ? styles.running : ''}`}
            onClick={runProgram}
            disabled={isRunning || isCompiling}
            title="Запустить программу (F5)"
          >
            <Play size={13} className={styles.playIcon} fill="currentColor" />
            <span>{isCompiling ? 'Компиляция...' : isRunning ? 'Выполнение...' : 'Run'}</span>
          </button>
          <button
            className={styles.runChevronBtn}
            onClick={() => setRunDropdownOpen(!runDropdownOpen)}
            title="Конфигурация запуска"
            aria-expanded={runDropdownOpen}
          >
            <ChevronDown size={12} />
          </button>

          {runDropdownOpen && (
            <div className={styles.runDropdownMenu}>
              <button
                className={styles.dropdownOption}
                onClick={() => {
                  setRunDropdownOpen(false);
                  runProgram();
                }}
              >
                <Activity size={13} className={styles.greenIcon} />
                <span>Запуск с бенчмарком</span>
              </button>
              <button
                className={styles.dropdownOption}
                onClick={() => {
                  setRunDropdownOpen(false);
                  runProgram();
                }}
              >
                <Terminal size={13} className={styles.blueIcon} />
                <span>Параллельный ForkJoinPool</span>
              </button>
            </div>
          )}
        </div>

        {/* Debug button */}
        <button
          className={styles.actionBtn}
          onClick={runProgram}
          title="Запуск в режиме отладки"
        >
          <Bug size={13} />
          <span>Debug</span>
        </button>
      </div>

      {/* Right Tools: Analysis, Theme, Settings */}
      <div className={styles.toolsGroup}>
        <button
          className={`${styles.iconBtn} ${isRightSidebarOpen ? styles.active : ''}`}
          onClick={toggleRightSidebar}
          title="Панель статического анализа кода"
          aria-label="Toggle analysis sidebar"
        >
          <SlidersHorizontal size={14} />
        </button>

        <button
          className={styles.iconBtn}
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={14} className={styles.sunIcon} /> : <Moon size={14} className={styles.moonIcon} />}
        </button>

        <button className={styles.iconBtn} title="Настройки" aria-label="Settings">
          <Settings size={14} />
        </button>
      </div>
    </header>
  );
};
