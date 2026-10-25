import React, { useState, useRef, useEffect } from 'react';
import {
  Upload,
  Download,
  Play,
  Moon,
  Sun,
  Bug,
  RotateCcw,
  Bot,
  ChevronRight,
  Sparkles,
  FileText,
  Sidebar,
  Image,
  Loader2,
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { exportGraphToPng } from '../../lib/export-image';
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
  const isLoading = useProjectStore((s) => s.isLoading);
  const error = useProjectStore((s) => s.error);

  const setShowOptimizationModal = useProjectStore((s) => s.setShowOptimizationModal);
  const revertOptimization = useProjectStore((s) => s.revertOptimization);
  const setShowImportModal = useProjectStore((s) => s.setShowImportModal);
  const exportJavaFile = useProjectStore((s) => s.exportJavaFile);
  const runProgram = useProjectStore((s) => s.runProgram);
  const addConsoleLog = useProjectStore((s) => s.addConsoleLog);

  const [isExportingPng, setIsExportingPng] = useState(false);
  const [runDropdownOpen, setRunDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleExportPng = async () => {
    try {
      setIsExportingPng(true);
      await exportGraphToPng(theme === 'dark', projectName);
      addConsoleLog('success', 'Снимок графа успешно сохранен в формате PNG');
    } catch (error) {
      console.error(error);
      addConsoleLog('error', 'Не удалось экспортировать граф в PNG');
    } finally {
      setIsExportingPng(false);
    }
  };

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

        <div className={styles.breadcrumb} title={error || undefined}>
          <span className={styles.projectName}>{projectName || 'OrderProcessingService'}</span>
          <ChevronRight size={13} className={styles.chevron} />
          <div className={styles.fileMethodPill}>
            <FileText size={14} className={styles.fileIcon} />
            <span className={styles.fileName}>{fileName}</span>
            <span className={styles.methodBadge}>{error ? 'Ошибка API' : isLoading ? 'Обработка...' : 'Java'}</span>
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
          title="Экспортировать текущий файл .java"
        >
          <Download size={13} />
          <span>Экспорт .java</span>
        </button>

        <button
          className={`${styles.actionBtn} ${isExportingPng ? styles.loading : ''}`}
          onClick={handleExportPng}
          disabled={isExportingPng}
          title="Скачать фото графа в формате PNG"
        >
          {isExportingPng ? (
            <Loader2 size={13} className={styles.spinner} />
          ) : (
            <Image size={13} />
          )}
          <span>{isExportingPng ? 'Экспорт...' : 'Экспорт в PNG'}</span>
        </button>

        <div className={styles.vDivider} />

        {/* Optimize button (Solid Orange filled button matching screenshot) */}
        {!isOptimized ? (
          <button
            className={styles.optimizeBtn}
            onClick={() => setShowOptimizationModal(true)}
            title="Статический анализ и рекомендации"
          >
            <Sparkles size={13} />
            <span>Анализ</span>
          </button>
        ) : (
          <button
            className={`${styles.optimizeBtn} ${styles.revert}`}
            onClick={revertOptimization}
            title="Вернуться к исходному коду"
          >
            <RotateCcw size={13} />
            <span>Отменить изменения</span>
          </button>
        )}

        {/* Run button with unified dropdown */}
        <div className={styles.runGroup} ref={dropdownRef}>
          <button
            className={`${styles.runBtn} ${isRunning || isCompiling ? styles.running : ''}`}
            onClick={() => void runProgram()}
            disabled={isRunning || isCompiling || isLoading}
            title="Запустить программу (F5)"
          >
            <Play size={13} className={styles.playIcon} fill="currentColor" />
            <span>{isCompiling ? 'Компиляция...' : isRunning ? 'Выполнение...' : 'Run'}</span>
          </button>
        </div>

        {/* Debug button */}
        <button
          className={styles.actionBtn}
          onClick={() => void runProgram()}
          disabled={isLoading || isRunning || isCompiling}
          title="Компиляция и проверка"
        >
          <Bug size={13} />
          <span>Проверить</span>
        </button>
      </div>

      <div className={styles.vDivider} />

      {/* Right Tools: Analysis, Theme, Settings */}
      <div className={styles.toolsGroup}>


        <button
          className={styles.iconBtn}
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Светлая тема: Night Owl Light (No Italics)' : 'Тёмная тема: Темная 2026 по умолчанию'}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={14} className={styles.sunIcon} /> : <Moon size={14} className={styles.moonIcon} />}
        </button>

        <button
          className={`${styles.iconBtn} ${isRightSidebarOpen ? styles.active : ''}`}
          onClick={toggleRightSidebar}
          title="Панель статического анализа кода"
          aria-label="Toggle analysis sidebar"
        >
          <Bot size={14} />
        </button>
      </div>
    </header>
  );
};
