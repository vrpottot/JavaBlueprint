import { create } from 'zustand';
import type { Node, Edge, NodeChange, EdgeChange } from '@xyflow/react';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import type { FileItem, CodeIssue, CodeRecommendation, CodeMetrics, ComplexityEstimate, ConsoleLog, TestCase, BlockType, VisualBlockData, AIProposal, ChatMessage } from '../types';
import { api, type ProjectSnapshot, type SourceFile, type Analysis, type Verification, submitAIProposal, type AIProposalResponse, type AIChatResponse, type MethodContainer } from '../services/api';
import { PALETTE_ITEMS } from '../lib/palette';
import { defaultMethod, scopeNodes } from '../lib/graph-scope';

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

const INITIAL_CHAT_MESSAGES: ChatMessage[] = [];

interface ProjectState {
  activeMethodId: string;
  setActiveMethodId: (id: string) => void;
  resetGraphLayout: () => void;
  openNodeSource: (id: string) => void;
  manualPositions: Record<string, { x: number; y: number }>;
  automaticPositions: Record<string, { x: number; y: number }>;
  containers: MethodContainer[];
  methodDialog: { mode: 'create' | 'edit'; containerId: string; nodeId?: string; revision: number; position?: { x: number; y: number }; initial?: NonNullable<VisualBlockData['method']> } | null;
  focusNodeRequest: { nodeId: string; nonce: number } | null;
  closeMethodDialog: () => void;
  saveMethod: (containerId: string, code: string) => Promise<void>;
  previewMethod: (containerId: string, code: string) => Promise<void>;
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
  methodComplexities: Analysis['complexity'];
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
  importJavaFile: (name: string, content: string, replaceProject?: boolean) => Promise<void>;
  importJavaFiles: (files: SourceFile[], replaceProject?: boolean) => Promise<void>;
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
  commitAIProposal: (proposal: AIProposal) => Promise<AIProposalResponse>;
  applyAIAnalysis: (analysis: AIChatResponse['parsedAnalysis']) => void;
  chatMessages: ChatMessage[];
  setChatMessages: (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  addChatMessage: (msg: ChatMessage) => void;
  clearChatMessages: () => void;
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
    const positions = !original && p.projectId === get().projectId ? get().manualPositions : {};
    const scope = get().activeMethodId;
    const prevMethodTitle = get().nodes.find(n => n.id === scope)?.data.title;
    const matchingMethod = p.graph.nodes.find(node => (node.id === scope || (prevMethodTitle && node.data.blockType === 'method' && node.data.title === prevMethodTitle)) && node.data.source?.file === path);
    const keepScope = !original && p.projectId === get().projectId && (scope === 'all' || scope === 'members' || Boolean(matchingMethod));
    const nextMethodId = keepScope ? (scope === 'all' || scope === 'members' ? scope : (matchingMethod?.id ?? defaultMethod(p.graph.nodes, path))) : defaultMethod(p.graph.nodes, path);
    set({
      projectId: p.projectId,
      revision: p.revision,
      sourceFiles: p.files,
      containers: p.containers ?? [],
      ...(original ? { originalFiles: p.files, isOptimized: false, codeViewMode: 'source' as const } : {}),
      mainClasses: p.structure.flatMap((f) => f.mainClasses),
      projectName: p.files[0]?.path.split('/').pop()?.replace('.java', '') || 'JavaBlueprint',
      files: p.files.map((f) => ({ id: f.path, path: f.path, name: f.path, type: 'file' as const })),
      activeFileId: path,
      activeFilePath: path,
      activeMethodId: nextMethodId,
      automaticPositions: Object.fromEntries(p.graph.nodes.map(node => [node.id, node.position])),
      manualPositions: Object.fromEntries(p.graph.nodes.filter(node => positions[node.id]).map(node => [node.id, positions[node.id]])),
      javaCode: p.files.find((f) => f.path === path)?.content || '',
      nodes: p.graph.nodes.map((n) => ({ ...n, position: positions[n.id] || n.position })),
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
      methodComplexities: result.complexity,
      complexity: {
        current: result.complexity.length === 1 ? (result.complexity[0].estimate === 'unknown' ? 'Неизвестно' : result.complexity[0].estimate) : 'По методам',
        optimized: '—',
        speedup: 'Не измерено',
        explanation: 'Оценки верхней границы по AST. Предположения и ограничения указаны для каждого метода.',
      },
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

  const applyMethodSnapshot = (p: ProjectSnapshot, position?: { x: number; y: number }) => {
    const change = p.changes?.find(c => ['addMethod', 'replaceMethod', 'duplicateMethod'].includes(c.operation));
    const method = p.graph.nodes.find(n => n.id === change?.nodeId);
    if (method) {
      const existing = get().nodes.find(n => n.id === method.id);
      const anchor = position ?? existing?.position ?? { x: Math.max(0, ...get().nodes.map(n => n.position.x)) + 500, y: 0 };
      const delta = { x: anchor.x - method.position.x, y: anchor.y - method.position.y };
      p.graph.nodes = p.graph.nodes.map(n => n.data.methodId === method.id ? { ...n, position: { x: n.position.x + delta.x, y: n.position.y + delta.y } } : n);
    }
    accept(p);
    set({ isOptimized: true, codeViewMode: 'optimized', mainWorkspaceTab: 'graph' });
    if (method) {
      const file = p.files.find(f => f.path === (method.data.source as { file: string }).file);
      if (file) set({ activeFileId: file.path, activeFilePath: file.path, javaCode: file.content });
      get().selectNode(method.id);
      set({ focusNodeRequest: { nodeId: method.id, nonce: Date.now() } });
    }
  };

  const transform = async (operation: { type: string; nodeId: string; code?: string }) => {
    let applied = false;
    await busy(async () => {
      if (get().dirty) throw new Error('Дождитесь разбора изменений Java перед редактированием графа.');
      if (!get().projectId) throw new Error('Сначала импортируйте Java-файл.');
      const p = await api<ProjectSnapshot>(`/projects/${get().projectId}/transform`, { revision: get().revision, operations: [operation] });
      if (operation.type.endsWith('Method')) applyMethodSnapshot(p); else accept(p);
      applied = true;
      set({ isOptimized: true, codeViewMode: 'optimized' });
      try { await analysis(); } catch { log('warn', 'Код сохранён. Анализ временно недоступен.'); }
      log('success', 'Java-код обновлён через AST. Запустите проверку компиляции и поведения.');
    });
    return applied;
  };

  return {
    activeMethodId: 'members', manualPositions: {}, automaticPositions: {},
    setActiveMethodId: (id) => {
      if (id !== 'all' && id !== 'members' && !get().nodes.some(n => n.id === id && n.data.source?.file === get().activeFilePath && n.data.blockType === 'method')) return;
      set({ activeMethodId: id, selectedNodeId: null, mainWorkspaceTab: 'graph' });
    },
    resetGraphLayout: () => {
      const visible = new Set(scopeNodes(get().nodes, get().activeFilePath, get().activeMethodId).map(node => node.id));
      set({ manualPositions: Object.fromEntries(Object.entries(get().manualPositions).filter(([id]) => !visible.has(id))), nodes: get().nodes.map(node => visible.has(node.id) ? { ...node, position: get().automaticPositions[node.id] ?? node.position } : node) });
    },
    openNodeSource: (id) => {
      const node = get().nodes.find(n => n.id === id);
      if (!node?.data.source) return;
      const path = node.data.source.file;
      get().selectNode(id);
      set({ activeFileId: path, activeFilePath: path, javaCode: get().sourceFiles.find(file => file.path === path)?.content ?? '', codeViewMode: get().isOptimized ? 'optimized' : 'source', mainWorkspaceTab: 'editor' });
    },
    containers: [], methodDialog: null, focusNodeRequest: null,
    closeMethodDialog: () => { if (!get().isLoading) set({ methodDialog: null }); },
    previewMethod: async (containerId, code) => {
      const dialog = get().methodDialog;
      if (!dialog || get().isLoading) throw new Error('Дождитесь завершения текущей операции.');
      await api(`/projects/${get().projectId}/transform/preview`, { revision: dialog.revision, operations: [{ type: dialog.mode === 'edit' ? 'replaceMethod' : 'addMethod', nodeId: dialog.nodeId ?? containerId, code }] });
    },
    saveMethod: async (containerId, code) => {
      const dialog = get().methodDialog;
      if (!dialog || get().isLoading) throw new Error('Дождитесь завершения текущей операции.');
      if (get().dirty) throw new Error('Дождитесь разбора Java-кода перед сохранением метода.');
      set({ isLoading: true, error: null });
      try {
        const p = await api<ProjectSnapshot>(`/projects/${get().projectId}/transform`, { revision: dialog.revision, operations: [{ type: dialog.mode === 'edit' ? 'replaceMethod' : 'addMethod', nodeId: dialog.nodeId ?? containerId, code }] });
        applyMethodSnapshot(p, dialog.position);
        log('success', dialog.mode === 'edit' ? 'Метод обновлён в Java-коде и на схеме.' : 'Метод добавлен в Java-код и на схему.');
        try { await analysis(); } catch { log('warn', 'Метод сохранён. Анализ временно недоступен.'); }
        set({ methodDialog: null, editingNode: null, showAddBlockModal: false });
      } finally { set({ isLoading: false }); }
    },
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
    methodComplexities: [],
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
      if (file) set({ activeFileId: id, activeFilePath: id, javaCode: file.content, activeMethodId: defaultMethod(get().nodes, id), selectedNodeId: null });
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
      const positions = { ...get().manualPositions };
      for (const change of changes) if (change.type === 'position' && change.position && change.dragging !== undefined) positions[change.id] = change.position;
      set({ manualPositions: positions, nodes: applyNodeChanges(changes.filter((c) => c.type !== 'remove'), get().nodes) });
    },

    onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes.filter((c) => c.type !== 'remove'), get().edges) }),

    selectNode: (id) => {
      const node = get().nodes.find(n => n.id === id);
      const source = node?.data.source;
      const outside = node && !scopeNodes([node], get().activeFilePath, get().activeMethodId).length;
      set({
        selectedNodeId: id,
        ...(outside && source
          ? {
            activeFileId: source.file,
            activeFilePath: source.file,
            activeMethodId: node.data.methodId ?? 'members',
            javaCode: get().sourceFiles.find(f => f.path === source.file)?.content ?? '',
            codeViewMode: 'optimized' as const,
          }
          : {}),
        nodes: get().nodes.map(n => ({
          ...n,
          selected: n.id === id,
          data: { ...n.data, isHighlighted: n.id === id },
        })),
      });
    },

    setEditingNode: (editingNode) => {
      if (editingNode?.data.astKind === 'MethodDeclaration' && editingNode.data.method && editingNode.data.editable?.includes('replaceMethod')) {
        if (get().dirty || get().isLoading) { fail(new Error('Дождитесь завершения разбора Java-кода.')); return; }
        set({ editingNode: null, error: null, methodDialog: { mode: 'edit', nodeId: editingNode.id, containerId: editingNode.data.containerId || '', revision: get().revision, initial: editingNode.data.method } });
      } else set({ editingNode, error: null });
    },

    updateNodeData: async (id, data) => {
      const n = get().nodes.find((node) => node.id === id);
      if (!n || data.codeSnippet === undefined) return;
      const supported = (n.data.editable as string[]) || [];
      const type = supported.includes('updateCondition')
        ? 'updateCondition'
        : n.data.astKind === 'FieldDeclaration'
        ? 'updateVariable'
        : n.data.astKind === 'SwitchStmt' || n.data.astKind === 'ForEachStmt'
        ? 'updateExpression'
        : supported.includes('replaceStatement')
        ? 'replaceStatement'
        : 'updateExpression';
      if (!supported.includes(type)) {
        fail(new Error('Редактирование этого блока не поддерживается. Измените исходный Java-код.'));
        return;
      }
      const code = type === 'updateExpression' && n.data.astKind === 'ExpressionStmt' ? data.codeSnippet.trim().replace(/;\s*$/, '') : data.codeSnippet;
      if (await transform({ type, nodeId: id, code })) set({ editingNode: null });
    },

    addNode: async (type, position) => {
      if (type === 'method') {
        await busy(async () => {
          await sync();
          const selected = get().nodes.find(n => n.id === get().selectedNodeId);
          const target = get().containers.find(c => c.id === selected?.data.containerId && c.canAddMethods)
            ?? get().containers.find(c => c.file === get().activeFilePath && c.canAddMethods)
            ?? get().containers.find(c => c.canAddMethods);
          if (!target) throw new Error('Импортируйте Java-класс или интерфейс, в который можно добавить метод.');
          set({ error: null, showAddBlockModal: false, methodDialog: { mode: 'create', containerId: target.id, revision: get().revision, position } });
        });
        return;
      }
      const selected = get().nodes.find((n) => n.id === get().selectedNodeId) || get().nodes.find(n => n.id === get().activeMethodId && n.data.editable?.includes('addBlock')) || get().nodes.find(n => n.data.source?.file === get().activeFilePath && n.data.blockType === 'method' && n.data.editable?.includes('addBlock'));
      if (!selected) {
        fail(new Error('Выберите метод или оператор, после которого добавить блок.'));
        return;
      }
      let code = PALETTE_ITEMS.find((p) => p.type === type)?.defaultCode;
      if (type === 'variable' || type === 'loop') {
        const used = new Set((get().sourceFiles.find(f => f.path === get().activeFilePath)?.content ?? '').match(/[A-Za-z_$][\w$]*/g));
        const base = type === 'variable' ? 'value' : 'index';
        let name = base, suffix = 2;
        while (used.has(name)) name = `${base}${suffix++}`;
        code = type === 'variable' ? `int ${name} = 0;` : `for (int ${name} = 0; ${name} < 10; ${name}++) { }`;
      }
      if (!code) {
        fail(new Error('Выберите поддерживаемый тип блока.'));
        return;
      }
      await transform({ type: 'addBlock', nodeId: selected.id, code });
    },

    deleteNode: async (id) => { await transform({ type: get().nodes.find(n => n.id === id)?.data.astKind === 'MethodDeclaration' ? 'deleteMethod' : 'deleteBlock', nodeId: id }); },

    duplicateNode: async (id) => { await transform({ type: get().nodes.find(n => n.id === id)?.data.astKind === 'MethodDeclaration' ? 'duplicateMethod' : 'duplicateBlock', nodeId: id }); },

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

    importJavaFile: (name, content, replaceProject = false) => get().importJavaFiles([{ path: name, content }], replaceProject),

    importJavaFiles: (files, replaceProject = false) =>
      busy(async () => {
        const currentProjectId = get().projectId;
        const currentFiles = get().sourceFiles;

        if (replaceProject || !currentProjectId || currentFiles.length === 0) {
          const oldId = currentProjectId;
          const p = await api<ProjectSnapshot>('/projects/parse', { files });
          accept(p, true);
          set({ showImportModal: false });
          await analysis();
          if (oldId && oldId !== p.projectId) void api(`/projects/${oldId}`, undefined, 'DELETE').catch(() => {});
          log('success', `Создан проект: загружено файлов ${files.length}, узлов ${p.graph.nodes.length}.`);
        } else {
          // Merge incoming files with existing project files so old files are kept
          const fileMap = new Map<string, SourceFile>();
          for (const f of currentFiles) {
            fileMap.set(f.path, f);
          }
          for (const f of files) {
            fileMap.set(f.path, f);
          }
          const mergedFiles = Array.from(fileMap.values());
          const targetPath = files[files.length - 1]?.path || mergedFiles[0].path;

          const updated = await api<ProjectSnapshot>(`/projects/${currentProjectId}/sources`, {
            revision: get().revision,
            files: mergedFiles,
          }, 'PUT');

          set({
            activeFilePath: targetPath,
            activeFileId: targetPath,
            showImportModal: false,
          });

          accept(updated, true);

          set({
            activeFilePath: targetPath,
            activeFileId: targetPath,
            javaCode: mergedFiles.find((f) => f.path === targetPath)?.content || '',
          });

          await analysis();
          log('success', `Файл(ы) успешно добавлен(ы) в проект (${files.map((f) => f.path).join(', ')}). Всего файлов: ${mergedFiles.length}.`);
        }
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

    commitAIProposal: async (proposal: AIProposal) => {
      if (!get().projectId) throw new Error('Проект не инициализирован. Импортируйте Java-код.');
      set({ isLoading: true, error: null });
      try {
        const res = await submitAIProposal(get().projectId!, proposal);
        accept(res);
        set({ isOptimized: true, codeViewMode: 'optimized' });
        await analysis();
        log('success', `ИИ-предложение успешно верифицировано и применено! Результат: ${res.verification.comparison.status}`);
        return res;
      } catch (err: unknown) {
        fail(err);
        throw err;
      } finally {
        set({ isLoading: false });
      }
    },

    applyAIAnalysis: (analysis) => {
      if (!analysis) return;
      set((state) => {
        const aiIssues = analysis.issues?.map((iss, idx) => ({
              ...iss,
              id: `ai:${iss.id || `issue-${idx + 1}`}`,
              title: `ИИ: ${iss.title}`,
              level: iss.level || 'medium',
              file: iss.file || state.activeFilePath || 'Main.java',
              line: iss.line ?? 1,
              resolved: false,
            })) ?? [];

        const aiRecs = analysis.recommendations?.map((rec, idx) => ({
              ...rec,
              id: `ai:${rec.id || `rec-${idx + 1}`}`,
              impact: rec.impact || 'medium',
              tag: 'ИИ-рекомендация',
            })) ?? [];

        return {
          issues: [...state.issues.filter(issue => !issue.id.startsWith('ai:')), ...aiIssues],
          recommendations: [...state.recommendations.filter(rec => !rec.id.startsWith('ai:')), ...aiRecs],
        };
      });
      log('info', 'Рекомендации ИИ добавлены. Метрики и Big O по методам остаются результатами AST-анализатора.');
    },

    chatMessages: INITIAL_CHAT_MESSAGES,

    setChatMessages: (updater) =>
      set((s) => ({
        chatMessages: typeof updater === 'function' ? updater(s.chatMessages) : updater,
      })),

    addChatMessage: (msg) =>
      set((s) => ({
        chatMessages: [...s.chatMessages, msg],
      })),

    clearChatMessages: () => set({ chatMessages: INITIAL_CHAT_MESSAGES }),
  };
});
