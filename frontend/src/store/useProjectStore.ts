import { create } from 'zustand';
import type { Node, Edge, NodeChange, EdgeChange } from '@xyflow/react';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import type {
  FileItem,
  CodeIssue,
  CodeRecommendation,
  CodeMetrics,
  ComplexityEstimate,
  ConsoleLog,
  TestCase,
  BlockType,
  VisualBlockData,
} from '../types';
import {
  INITIAL_FILES,
  INITIAL_JAVA_CODE,
  OPTIMIZED_JAVA_CODE,
  INITIAL_NODES,
  INITIAL_EDGES,
  OPTIMIZED_NODES,
  OPTIMIZED_EDGES,
  INITIAL_ISSUES,
  INITIAL_RECOMMENDATIONS,
  INITIAL_METRICS,
  INITIAL_COMPLEXITY,
  INITIAL_CONSOLE_LOGS,
  INITIAL_TEST_CASES,
  PALETTE_ITEMS,
} from '../lib/demo-data';

interface ProjectState {
  projectName: string;
  files: FileItem[];
  activeFileId: string;
  activeFilePath: string;
  javaCode: string;
  isOptimized: boolean;
  codeViewMode: 'source' | 'optimized';

  // React Flow Nodes & Edges
  nodes: Node<VisualBlockData>[];
  edges: Edge[];
  selectedNodeId: string | null;
  editingNode: Node<VisualBlockData> | null;

  // Analysis
  issues: CodeIssue[];
  recommendations: CodeRecommendation[];
  metrics: CodeMetrics;
  complexity: ComplexityEstimate;
  activeAnalysisTab: 'issues' | 'recommendations' | 'metrics';

  // Console & Tests
  consoleLogs: ConsoleLog[];
  testCases: TestCase[];
  isRunning: boolean;
  isCompiling: boolean;

  theme: 'light' | 'dark';
  toggleTheme: () => void;
  setTheme: (theme: 'light' | 'dark') => void;

  // Modals & Panels
  showOptimizationModal: boolean;
  showImportModal: boolean;
  showAddBlockModal: boolean;
  isLeftSidebarOpen: boolean;
  isRightSidebarOpen: boolean;
  bottomPanelHeight: number;

  // Actions
  selectFile: (fileId: string) => void;
  updateJavaCode: (code: string) => void;
  setCodeViewMode: (mode: 'source' | 'optimized') => void;
  onNodesChange: (changes: NodeChange<Node<VisualBlockData>>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  selectNode: (nodeId: string | null) => void;
  setEditingNode: (node: Node<VisualBlockData> | null) => void;
  updateNodeData: (nodeId: string, updatedData: Partial<VisualBlockData>) => void;
  addNode: (blockType: BlockType, position?: { x: number; y: number }) => void;
  deleteNode: (nodeId: string) => void;
  duplicateNode: (nodeId: string) => void;
  applyOptimization: () => void;
  revertOptimization: () => void;
  runProgram: () => void;
  importJavaFile: (filename: string, content: string) => void;
  exportJavaFile: () => void;
  setActiveAnalysisTab: (tab: 'issues' | 'recommendations' | 'metrics') => void;
  focusNodeFromIssue: (nodeId: string) => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setBottomPanelHeight: (height: number) => void;
  setShowOptimizationModal: (show: boolean) => void;
  setShowImportModal: (show: boolean) => void;
  setShowAddBlockModal: (show: boolean) => void;
  clearConsole: () => void;
  addConsoleLog: (type: 'info' | 'success' | 'warn' | 'error', message: string) => void;
}

const getCurrentTimestamp = () => {
  const d = new Date();
  return d.toTimeString().split(' ')[0];
};

export const useProjectStore = create<ProjectState>((set, get) => ({
  projectName: 'OrderProcessingService',
  files: INITIAL_FILES,
  activeFileId: 'f-main-java',
  activeFilePath: 'src/com.example/Main.java',
  javaCode: INITIAL_JAVA_CODE,
  isOptimized: false,
  codeViewMode: 'source',

  nodes: INITIAL_NODES,
  edges: INITIAL_EDGES,
  selectedNodeId: null,
  editingNode: null,

  issues: INITIAL_ISSUES,
  recommendations: INITIAL_RECOMMENDATIONS,
  metrics: INITIAL_METRICS,
  complexity: INITIAL_COMPLEXITY,
  activeAnalysisTab: 'issues',

  consoleLogs: INITIAL_CONSOLE_LOGS,
  testCases: INITIAL_TEST_CASES,
  isRunning: false,
  isCompiling: false,

  theme: 'light',
  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    set({ theme: next });
    document.documentElement.setAttribute('data-theme', next);
  },
  setTheme: (theme) => {
    set({ theme });
    document.documentElement.setAttribute('data-theme', theme);
  },

  showOptimizationModal: false,
  showImportModal: false,
  showAddBlockModal: false,
  isLeftSidebarOpen: true,
  isRightSidebarOpen: true,
  bottomPanelHeight: 270,

  selectFile: (fileId) => {
    const findPath = (items: FileItem[]): { path: string; name: string } | null => {
      for (const item of items) {
        if (item.id === fileId) return { path: item.path, name: item.name };
        if (item.children) {
          const res = findPath(item.children);
          if (res) return res;
        }
      }
      return null;
    };

    const target = findPath(get().files);
    if (!target) return;

    if (fileId === 'f-main-java') {
      set({
        activeFileId: fileId,
        activeFilePath: target.path,
        javaCode: get().isOptimized ? OPTIMIZED_JAVA_CODE : INITIAL_JAVA_CODE,
      });
    } else {
      set({
        activeFileId: fileId,
        activeFilePath: target.path,
        javaCode: `package ${target.path.split('/')[1] || 'com.example'};\n\n/**\n * Исходный файл ${target.name}\n * JavaScope: Анализ синтаксической структуры\n */\npublic class ${target.name.replace('.java', '')} {\n\n    public void execute() {\n        // TODO: реализация сервиса\n    }\n}\n`,
      });
    }
  },

  updateJavaCode: (code) => {
    set({ javaCode: code });
  },

  setCodeViewMode: (mode) => {
    set({
      codeViewMode: mode,
      javaCode: mode === 'optimized' ? OPTIMIZED_JAVA_CODE : INITIAL_JAVA_CODE,
    });
  },

  onNodesChange: (changes) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes),
    });
  },

  onEdgesChange: (changes) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
    });
  },

  selectNode: (nodeId) => {
    set({
      selectedNodeId: nodeId,
      nodes: get().nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          isHighlighted: node.id === nodeId,
        },
      })),
    });
  },

  setEditingNode: (node) => {
    set({ editingNode: node });
  },

  updateNodeData: (nodeId, updatedData) => {
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                ...updatedData,
              },
            }
          : node
      ),
      editingNode: null,
    });
    get().addConsoleLog('info', `Обновлён блок ${nodeId} (${updatedData.codeSnippet || updatedData.title})`);
  },

  addNode: (blockType, position) => {
    const paletteInfo = PALETTE_ITEMS.find((p) => p.type === blockType) || PALETTE_ITEMS[0];
    const newId = `node-${blockType}-${Date.now()}`;
    const newNode: Node<VisualBlockData> = {
      id: newId,
      type: `${blockType}Node`,
      position: position || { x: 300, y: (get().nodes.length + 1) * 90 },
      data: {
        title: paletteInfo.name,
        codeSnippet: paletteInfo.defaultCode,
        blockType,
        description: paletteInfo.description,
        badge: 'custom',
        isHighlighted: true,
      },
    };

    set({
      nodes: [...get().nodes, newNode],
      selectedNodeId: newId,
      showAddBlockModal: false,
    });

    get().addConsoleLog('info', `Добавлен новый блок: ${paletteInfo.name}`);
  },

  deleteNode: (nodeId) => {
    set({
      nodes: get().nodes.filter((node) => node.id !== nodeId),
      edges: get().edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      selectedNodeId: null,
    });
    get().addConsoleLog('warn', `Блок ${nodeId} удален из графа`);
  },

  duplicateNode: (nodeId) => {
    const target = get().nodes.find((n) => n.id === nodeId);
    if (!target) return;

    const newId = `${target.id}-copy-${Date.now()}`;
    const clonedNode: Node<VisualBlockData> = {
      ...target,
      id: newId,
      position: { x: target.position.x + 30, y: target.position.y + 30 },
      data: {
        ...target.data,
        title: `${target.data.title} (Копия)`,
        isHighlighted: true,
      },
    };

    set({
      nodes: [...get().nodes, clonedNode],
      selectedNodeId: newId,
    });
    get().addConsoleLog('info', `Блок ${target.data.title} скопирован`);
  },

  applyOptimization: () => {
    set({
      isOptimized: true,
      codeViewMode: 'optimized',
      javaCode: OPTIMIZED_JAVA_CODE,
      nodes: OPTIMIZED_NODES,
      edges: OPTIMIZED_EDGES,
      selectedNodeId: null,
      issues: INITIAL_ISSUES.map((issue) =>
        issue.id === 'issue-2' || issue.id === 'issue-3'
          ? { ...issue, resolved: true, description: `${issue.description} [РЕШЕНО ОПТИМИЗАЦИЕЙ]` }
          : issue
      ),
      metrics: {
        cyclomaticComplexity: 2,
        linesOfCode: 24,
        nestingDepth: 1,
        testCoverage: 98,
        maintainabilityIndex: 94,
      },
      complexity: {
        current: 'O(n log n)',
        optimized: 'O(n log n)',
        speedup: '5.2x достигнуто',
        explanation: 'Оптимизация успешно применена: задействован параллельный стрим, исключены лишние вложенные вызовы и дублирование.',
      },
      showOptimizationModal: false,
      testCases: [
        { id: 't-1', name: 'testEmptyList', status: 'success', durationMs: 1, details: 'Быстрый возврат List.of()' },
        { id: 't-2', name: 'testSingleOrder', status: 'success', durationMs: 3, details: 'Ускорение в 2.6x' },
        { id: 't-3', name: 'testInvalidOrder', status: 'success', durationMs: 2, details: 'Параллельная фильтрация' },
        { id: 't-4', name: 'testLargeDataset', status: 'success', durationMs: 27, details: 'Ускорение со 142ms до 27ms (5.25x)' },
      ],
    });

    get().addConsoleLog('success', 'Оптимизация алгоритма успешно применена!');
    get().addConsoleLog('info', 'Сложность снижена с O(n²) до O(n log n). Длина кода: 24 строки.');
  },

  revertOptimization: () => {
    set({
      isOptimized: false,
      codeViewMode: 'source',
      javaCode: INITIAL_JAVA_CODE,
      nodes: INITIAL_NODES,
      edges: INITIAL_EDGES,
      issues: INITIAL_ISSUES,
      metrics: INITIAL_METRICS,
      complexity: INITIAL_COMPLEXITY,
      testCases: INITIAL_TEST_CASES,
    });
    get().addConsoleLog('info', 'Возврат к исходной версии кода и графа');
  },

  runProgram: () => {
    if (get().isRunning || get().isCompiling) return;

    set({ isCompiling: true, isRunning: false });
    get().addConsoleLog('info', 'Начата компиляция JavaScope...');

    setTimeout(() => {
      set({ isCompiling: false, isRunning: true });
      get().addConsoleLog('success', 'Компиляция успешна (javac 21.0.2 target=21)');
      get().addConsoleLog('info', 'Запуск программы и профилирование потоков...');

      // Mark test cases as running
      set({
        testCases: get().testCases.map((tc) => ({ ...tc, status: 'running' })),
      });

      setTimeout(() => {
        get().addConsoleLog('info', 'Обработка данных (1523 элементов)...');

        setTimeout(() => {
          const duration = get().isOptimized ? '0.24 сек' : '1.24 сек';
          get().addConsoleLog('success', `Готово. Время выполнения: ${duration}`);
          get().addConsoleLog('info', 'Сравнение исходной и оптимизированной версии...');
          get().addConsoleLog('success', 'Поведение совпадает (100% покрытие проверок)');

          set({
            isRunning: false,
            testCases: get().testCases.map((tc) => ({ ...tc, status: 'success' })),
          });
        }, 600);
      }, 500);
    }, 600);
  },

  importJavaFile: (filename, content) => {
    const fileId = `f-imported-${Date.now()}`;
    const newFile: FileItem = {
      id: fileId,
      name: filename,
      path: `src/com.example/${filename}`,
      type: 'file',
      hasIssues: false,
    };

    const updatedFiles = [...get().files];
    const srcDir = updatedFiles[0];
    if (srcDir && srcDir.children && srcDir.children[0] && srcDir.children[0].children) {
      srcDir.children[0].children.push(newFile);
    }

    set({
      files: updatedFiles,
      activeFileId: fileId,
      activeFilePath: newFile.path,
      javaCode: content,
      showImportModal: false,
    });

    get().addConsoleLog('success', `Файл ${filename} успешно импортирован`);
  },

  exportJavaFile: () => {
    const code = get().javaCode;
    const filename = get().activeFilePath.split('/').pop() || 'Exported.java';
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    get().addConsoleLog('info', `Файл ${filename} экспортирован`);
  },

  setActiveAnalysisTab: (tab) => {
    set({ activeAnalysisTab: tab });
  },

  focusNodeFromIssue: (nodeId) => {
    get().selectNode(nodeId);
    get().addConsoleLog('info', `Фокус на блоке проблемы: ${nodeId}`);
  },

  toggleLeftSidebar: () => {
    set({ isLeftSidebarOpen: !get().isLeftSidebarOpen });
  },

  toggleRightSidebar: () => {
    set({ isRightSidebarOpen: !get().isRightSidebarOpen });
  },

  setBottomPanelHeight: (height) => {
    const clamped = Math.max(140, Math.min(height, 500));
    set({ bottomPanelHeight: clamped });
  },

  setShowOptimizationModal: (show) => {
    set({ showOptimizationModal: show });
  },

  setShowImportModal: (show) => {
    set({ showImportModal: show });
  },

  setShowAddBlockModal: (show) => {
    set({ showAddBlockModal: show });
  },

  clearConsole: () => {
    set({ consoleLogs: [] });
  },

  addConsoleLog: (type, message) => {
    const newLog: ConsoleLog = {
      id: `log-${Date.now()}-${Math.random()}`,
      timestamp: getCurrentTimestamp(),
      type,
      message,
    };
    set({ consoleLogs: [...get().consoleLogs, newLog] });
  },
}));
