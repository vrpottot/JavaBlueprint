import { create } from 'zustand';
import type { Node, Edge, NodeChange, EdgeChange } from '@xyflow/react';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import type { FileItem, CodeIssue, CodeRecommendation, CodeMetrics, ComplexityEstimate, ConsoleLog, TestCase, BlockType, VisualBlockData } from '../types';
import { api, type ProjectSnapshot, type SourceFile, type Analysis, type Verification } from '../services/api';
import { PALETTE_ITEMS } from '../lib/palette';

const SAMPLE = `import java.util.Scanner;

public class Main {
    public static int classify(int value) {
        if (value > 0) {
            return 1;
        }
        return 0;
    }

    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        int value = scanner.hasNextInt() ? scanner.nextInt() : 5;
        System.out.println(classify(value));
    }
}
`;

const emptyMetrics: CodeMetrics = { cyclomaticComplexity: 0, linesOfCode: 0, nestingDepth: 0, testCoverage: null, maintainabilityIndex: null };

interface ProjectState {
  projectId: string | null;
  revision: number;
  sourceFiles: SourceFile[];
  originalFiles: SourceFile[];
  mainClasses: string[];
  dirty: boolean;
  isLoading: boolean;
  error: string | null;
  projectName: string;
  files: FileItem[];
  activeFileId: string;
  activeFilePath: string;
  javaCode: string;
  isOptimized: boolean;
  codeViewMode: 'source' | 'optimized';
  nodes: Node<VisualBlockData>[];
  edges: Edge[];
  selectedNodeId: string | null;
  editingNode: Node<VisualBlockData> | null;
  issues: CodeIssue[];
  recommendations: CodeRecommendation[];
  metrics: CodeMetrics;
  complexity: ComplexityEstimate;
  activeAnalysisTab: 'issues' | 'recommendations' | 'metrics';
  consoleLogs: ConsoleLog[];
  testCases: TestCase[];
  isRunning: boolean;
  isCompiling: boolean;
  runStdin: string;
  theme: 'light' | 'dark';
  showOptimizationModal: boolean;
  showImportModal: boolean;
  showAddBlockModal: boolean;
  isLeftSidebarOpen: boolean;
  isRightSidebarOpen: boolean;
  mainWorkspaceTab: 'graph' | 'editor';
  bottomPanelHeight: number;
  initialize: () => Promise<void>;
  syncSources: () => Promise<void>;
  selectFile: (id: string) => void;
  updateJavaCode: (code: string) => void;
  setCodeViewMode: (mode: 'source' | 'optimized') => void;
  setMainWorkspaceTab: (tab: 'graph' | 'editor') => void;
  onNodesChange: (changes: NodeChange<Node<VisualBlockData>>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  selectNode: (id: string | null) => void;
  setEditingNode: (node: Node<VisualBlockData> | null) => void;
  updateNodeData: (id: string, data: Partial<VisualBlockData>) => Promise<void>;
  addNode: (type: BlockType, position?: { x: number; y: number }) => Promise<void>;
  deleteNode: (id: string) => Promise<void>;
  duplicateNode: (id: string) => Promise<void>;
  applyOptimization: () => Promise<void>;
  revertOptimization: () => Promise<void>;
  runProgram: () => Promise<void>;
  importJavaFile: (name: string, content: string) => Promise<void>;
  importJavaFiles: (files: SourceFile[]) => Promise<void>;
  exportJavaFile: () => Promise<void>;
  setRunStdin: (value: string) => void;
  toggleTheme: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setActiveAnalysisTab: (tab: 'issues' | 'recommendations' | 'metrics') => void;
  focusNodeFromIssue: (id: string) => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  setBottomPanelHeight: (height: number) => void;
  setShowOptimizationModal: (v: boolean) => void;
  setShowImportModal: (v: boolean) => void;
  setShowAddBlockModal: (v: boolean) => void;
  clearConsole: () => void;
  addConsoleLog: (type: ConsoleLog['type'], message: string) => void;
}

let debounce: ReturnType<typeof setTimeout> | undefined;

export const useProjectStore = create<ProjectState>((set, get) => {
  const log = (type: ConsoleLog['type'], message: string) => get().addConsoleLog(type, message);
  const fail = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    set({ error: message });
    log('error', message);
  };

  const accept = (p: ProjectSnapshot, original = false) => {
    const path = p.files.some((f) => f.path === get().activeFilePath) ? get().activeFilePath : p.files[0]?.path || '';
    const positions = !original && p.projectId === get().projectId ? new Map(get().nodes.map((n) => [n.id, n.position])) : new Map();
    set({
      projectId: p.projectId,
      revision: p.revision,
      sourceFiles: p.files,
      ...(original ? { originalFiles: p.files, isOptimized: false, codeViewMode: 'source' as const } : {}),
      mainClasses: p.structure.flatMap((f) => f.mainClasses),
      projectName: p.files[0]?.path.split('/').pop()?.replace('.java', '') || 'JavaBlueprint',
      files: p.files.map((f) => ({ id: f.path, path: f.path, name: f.path, type: 'file' as const })),
      activeFileId: path,
      activeFilePath: path,
      javaCode: p.files.find((f) => f.path === path)?.content || '',
      nodes: p.graph.nodes.map((n) => ({ ...n, position: positions.get(n.id) || n.position })),
      edges: p.graph.edges,
      selectedNodeId: null,
      editingNode: null,
      dirty: false,
      error: null,
      testCases: [],
    });
    p.graph.warnings.forEach((w) => log('warn', w));
  };

  const analysis = async () => {
    if (!get().projectId) return;
    const result = await api<Analysis>(`/projects/${get().projectId}/analyze`, {});
    set({
      issues: result.diagnostics.map((d) => ({ ...d, level: d.severity })),
      recommendations: result.diagnostics.map((d) => ({ id: d.id, title: d.title, description: d.recommendation, impact: d.severity, tag: 'Статический анализ' })),
      metrics: result.metrics,
      complexity: { current: 'Неизвестно', optimized: '—', speedup: 'Не измерено', explanation: result.complexity.map((c) => c.explanation).join('\n') || 'Исполняемые методы не найдены.' },
    });
  };

  const sync = async () => {
    clearTimeout(debounce);
    if (!get().dirty || !get().projectId) return;
    accept(await api<ProjectSnapshot>(`/projects/${get().projectId}/sources`, { revision: get().revision, files: get().sourceFiles }, 'PUT'));
    set({ isOptimized: true, codeViewMode: 'optimized' });
    await analysis();
  };

  const busy = async (work: () => Promise<void>) => {
    if (get().isLoading || get().isRunning || get().isCompiling) return;
    set({ isLoading: true, error: null });
    try {
      await work();
    } catch (error) {
      fail(error);
    } finally {
      set({ isLoading: false });
    }
  };

  const transform = async (operation: { type: string; nodeId: string; code?: string }) =>
    busy(async () => {
      if (get().dirty) throw new Error('Дождитесь разбора изменений Java перед редактированием графа.');
      if (!get().projectId) throw new Error('Сначала импортируйте Java-файл.');
      accept(await api<ProjectSnapshot>(`/projects/${get().projectId}/transform`, { revision: get().revision, operations: [operation] }));
      set({ isOptimized: true, codeViewMode: 'optimized' });
      await analysis();
      log('success', 'Java-код обновлён через AST. Запустите проверку компиляции и поведения.');
    });

  return {
    projectId: null,
    revision: 0,
    sourceFiles: [],
    originalFiles: [],
    mainClasses: [],
    dirty: false,
    isLoading: false,
    error: null,
    projectName: 'JavaBlueprint',
    files: [],
    activeFileId: '',
    activeFilePath: '',
    javaCode: '',
    isOptimized: false,
    codeViewMode: 'source',
    nodes: [],
    edges: [],
    selectedNodeId: null,
    editingNode: null,
    issues: [],
    recommendations: [],
    metrics: emptyMetrics,
    complexity: { current: 'Неизвестно', optimized: '—', speedup: 'Не измерено', explanation: 'Загрузите Java-код для анализа.' },
    activeAnalysisTab: 'issues',
    consoleLogs: [],
    testCases: [],
    isRunning: false,
    isCompiling: false,
    runStdin: '5\n',
    theme: 'light',
    showOptimizationModal: false,
    showImportModal: false,
    showAddBlockModal: false,
    isLeftSidebarOpen: true,
    isRightSidebarOpen: true,
    mainWorkspaceTab: 'graph',
    bottomPanelHeight: 220,

    initialize: async () => {
      if (!get().projectId && !get().isLoading) await get().importJavaFiles([{ path: 'Main.java', content: SAMPLE }]);
    },

    syncSources: () => busy(sync),

    selectFile: (id) => {
      const file = (get().codeViewMode === 'source' && get().isOptimized ? get().originalFiles : get().sourceFiles).find((f) => f.path === id);
      if (file) set({ activeFileId: id, activeFilePath: id, javaCode: file.content });
    },

    updateJavaCode: (code) => {
      if (get().isLoading || get().isRunning || get().isCompiling || (get().codeViewMode === 'source' && get().isOptimized)) return;
      set({ javaCode: code, sourceFiles: get().sourceFiles.map((f) => (f.path === get().activeFilePath ? { ...f, content: code } : f)), dirty: true, testCases: [] });
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        void get().syncSources();
      }, 700);
    },

    setCodeViewMode: (mode) => {
      const files = mode === 'source' && get().isOptimized ? get().originalFiles : get().sourceFiles;
      set({ codeViewMode: mode, javaCode: files.find((f) => f.path === get().activeFilePath)?.content || '' });
    },

    setMainWorkspaceTab: (mainWorkspaceTab) => {
      set({ mainWorkspaceTab });
    },

    onNodesChange: (changes) => {
      changes.filter((c) => c.type === 'remove').forEach((c) => {
        void get().deleteNode(c.id);
      });
      set({ nodes: applyNodeChanges(changes.filter((c) => c.type !== 'remove'), get().nodes) });
    },

    onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes.filter((c) => c.type !== 'remove'), get().edges) }),

    selectNode: (id) => set({ selectedNodeId: id, nodes: get().nodes.map((n) => ({ ...n, data: { ...n.data, isHighlighted: n.id === id } })) }),

    setEditingNode: (editingNode) => set({ editingNode }),

    updateNodeData: async (id, data) => {
      const n = get().nodes.find((node) => node.id === id);
      if (!n || data.codeSnippet === undefined) return;
      const supported = (n.data.editable as string[]) || [];
      const type = supported.includes('updateCondition')
        ? 'updateCondition'
        : n.data.astKind === 'FieldDeclaration'
        ? 'updateVariable'
        : n.data.astKind === 'SwitchStmt'
        ? 'updateExpression'
        : supported.includes('replaceStatement')
        ? 'replaceStatement'
        : 'updateExpression';
      if (!supported.includes(type)) {
        fail(new Error('Редактирование этого блока не поддерживается. Измените исходный Java-код.'));
        return;
      }
      await transform({ type, nodeId: id, code: data.codeSnippet });
    },

    addNode: async (type) => {
      const selected = get().nodes.find((n) => n.id === get().selectedNodeId) || get().nodes.find((n) => n.data.blockType === 'method' && (n.data.editable as string[]).includes('addBlock'));
      if (!selected) {
        fail(new Error('Выберите метод или оператор, после которого добавить блок.'));
        return;
      }
      const code = PALETTE_ITEMS.find((p) => p.type === type)?.defaultCode;
      if (!code) {
        fail(new Error('Новые методы добавляются в редакторе Java.'));
        return;
      }
      await transform({ type: 'addBlock', nodeId: selected.id, code });
    },

    deleteNode: (id) => transform({ type: 'deleteBlock', nodeId: id }),

    duplicateNode: (id) => transform({ type: 'duplicateBlock', nodeId: id }),

    applyOptimization: () =>
      busy(async () => {
        await sync();
        await analysis();
        set({ showOptimizationModal: true });
      }),

    revertOptimization: () =>
      busy(async () => {
        if (!get().projectId) return;
        accept(await api<ProjectSnapshot>(`/projects/${get().projectId}/sources`, { revision: get().revision, files: get().originalFiles }, 'PUT'));
        set({ isOptimized: false, codeViewMode: 'source' });
        await analysis();
      }),

    runProgram: () =>
      busy(async () => {
        await sync();
        if (!get().projectId) throw new Error('Сначала импортируйте Java-файл.');
        set({ isCompiling: true });
        log('info', 'Компиляция javac и проверка в Docker...');
        const mainClass = get().mainClasses[0];
        const result = await api<Verification>(`/projects/${get().projectId}/verify`, {
          revision: get().revision,
          compare: true,
          ...(mainClass ? { mainClass, inputs: [{ name: 'stdin', stdin: get().runStdin }] } : {}),
        });
        const compilation = result.current.compilation;
        log(compilation.exitCode === 0 ? 'success' : 'error', `javac: exit=${compilation.exitCode}; ${compilation.durationMs} мс${compilation.timedOut ? '; timeout' : ''}`);
        if (compilation.stdout) log('info', compilation.stdout);
        if (compilation.stderr) log(compilation.exitCode === 0 ? 'warn' : 'error', compilation.stderr);
        for (const run of result.current.runs) {
          if (run.stdout) log('info', run.stdout);
          if (run.stderr) log('error', run.stderr);
          log(
            run.exitCode === 0 && !run.timedOut && !run.outputLimitExceeded ? 'success' : 'error',
            `${run.name}: exit=${run.exitCode}; ${run.durationMs} мс${run.timedOut ? '; timeout' : ''}`
          );
        }
        set({ testCases: result.current.tests.cases });
        if (result.current.tests.status === 'not_run') log('warn', 'JUnit-тесты не найдены. Импортируйте тестовые .java-файлы вместе с проектом.');
        log(result.comparison.status === 'matched_on_inputs' ? 'success' : 'warn', result.comparison.explanation);
        set({ isCompiling: false, isRunning: false });
      }).finally(() => {
        if (!get().isLoading) set({ isCompiling: false, isRunning: false });
      }),

    importJavaFile: (name, content) => get().importJavaFiles([{ path: name, content }]),

    importJavaFiles: (files) =>
      busy(async () => {
        const oldId = get().projectId;
        const p = await api<ProjectSnapshot>('/projects/parse', { files });
        accept(p, true);
        set({ showImportModal: false });
        await analysis();
        if (oldId) void api(`/projects/${oldId}`, undefined, 'DELETE').catch(() => {});
        log('success', `JavaParser: загружено файлов ${files.length}, узлов ${p.graph.nodes.length}.`);
      }),

    exportJavaFile: () =>
      busy(async () => {
        await sync();
        const generated = await api<{ files: SourceFile[] }>(`/projects/${get().projectId}/generate`, {});
        const file = generated.files.find((f) => f.path === get().activeFilePath);
        if (!file) return;
        const url = URL.createObjectURL(new Blob([file.content], { type: 'text/plain;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = file.path.split('/').pop() || 'Main.java';
        link.click();
        URL.revokeObjectURL(url);
      }),

    setRunStdin: (runStdin) => set({ runStdin }),

    toggleTheme: () => get().setTheme(get().theme === 'light' ? 'dark' : 'light'),

    setTheme: (theme) => {
      set({ theme });
      document.documentElement.setAttribute('data-theme', theme);
    },

    setActiveAnalysisTab: (activeAnalysisTab) => set({ activeAnalysisTab }),

    focusNodeFromIssue: (id) => {
      set({ mainWorkspaceTab: 'graph' });
      const node = get().nodes.find((n) => n.id === id);
      const source = node?.data.source as { file?: string } | undefined;
      if (source?.file) get().selectFile(source.file);
      get().selectNode(id);
    },

    toggleLeftSidebar: () => set({ isLeftSidebarOpen: !get().isLeftSidebarOpen }),

    toggleRightSidebar: () => set({ isRightSidebarOpen: !get().isRightSidebarOpen }),

    setBottomPanelHeight: (height) => set({ bottomPanelHeight: Math.max(140, Math.min(height, 500)) }),

    setShowOptimizationModal: (showOptimizationModal) => set({ showOptimizationModal }),

    setShowImportModal: (showImportModal) => set({ showImportModal }),

    setShowAddBlockModal: (showAddBlockModal) => set({ showAddBlockModal }),

    clearConsole: () => set({ consoleLogs: [] }),

    addConsoleLog: (type, message) =>
      set({
        consoleLogs: [
          ...get().consoleLogs.slice(-299),
          { id: crypto.randomUUID(), timestamp: new Date().toLocaleTimeString(), type, message },
        ],
      }),
  };
});
