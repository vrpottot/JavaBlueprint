import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  useReactFlow,
  useViewport,
  useNodesInitialized,
  ReactFlowProvider,
  type Node,
} from '@xyflow/react';
import {
  Maximize2,
  ZoomIn,
  ZoomOut,
  Edit3,
  Copy,
  Trash2,
  ArrowUpRight,
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import type { VisualBlockData, BlockType } from '../../types';
import { MethodNode } from './nodes/MethodNode';
import { VariableNode } from './nodes/VariableNode';
import { ConditionNode } from './nodes/ConditionNode';
import { LoopNode } from './nodes/LoopNode';
import { OperationNode } from './nodes/OperationNode';
import { ReturnNode } from './nodes/ReturnNode';
import { NodeEditModal } from './NodeEditModal';
import styles from './VisualCanvas.module.scss';
import { scopeNodes } from '../../lib/graph-scope';
import { decorateDiagnostics } from '../../lib/diagnostics';

interface ContextMenuState {
  x: number;
  y: number;
  node: Node<VisualBlockData>;
}

const CanvasInner: React.FC = () => {
  const theme = useProjectStore((s) => s.theme);
  const projectId = useProjectStore(s => s.projectId);
  const activeFilePath = useProjectStore((s) => s.activeFilePath);
  const nodes = useProjectStore((s) => s.nodes);
  const edges = useProjectStore((s) => s.edges);
  const onNodesChange = useProjectStore((s) => s.onNodesChange);
  const onEdgesChange = useProjectStore((s) => s.onEdgesChange);
  const onConnect = useProjectStore((s) => s.onConnect);
  const onReconnect = useProjectStore((s) => s.onReconnect);
  const codeGeneratedNotice = useProjectStore((s) => s.codeGeneratedNotice);
  const clearCodeGeneratedNotice = useProjectStore((s) => s.clearCodeGeneratedNotice);
  const selectNode = useProjectStore((s) => s.selectNode);
  const setEditingNode = useProjectStore((s) => s.setEditingNode);
  const addNode = useProjectStore((s) => s.addNode);
  const duplicateNode = useProjectStore((s) => s.duplicateNode);
  const deleteNode = useProjectStore((s) => s.deleteNode);
  const focusNodeRequest = useProjectStore((s) => s.focusNodeRequest);
  const methodDialog = useProjectStore((s) => s.methodDialog);
  const editingNode = useProjectStore(s => s.editingNode);
  const activeMethodId = useProjectStore(s => s.activeMethodId);
  const setActiveMethodId = useProjectStore(s => s.setActiveMethodId);
  const resetGraphLayout = useProjectStore(s => s.resetGraphLayout);
  const openNodeSource = useProjectStore(s => s.openNodeSource);
  const dirty = useProjectStore(s => s.dirty);
  const issues = useProjectStore(s => s.issues);
  const [methodSearch, setMethodSearch] = useState('');
  const methods = useMemo(() => nodes.filter(n => n.data.source?.file === activeFilePath && n.data.blockType === 'method'), [nodes, activeFilePath]);
  const visibleNodes = useMemo(() => decorateDiagnostics(scopeNodes(nodes, activeFilePath, activeMethodId), issues), [nodes, activeFilePath, activeMethodId, issues]);
  const visibleIds = useMemo(() => new Set(visibleNodes.map(n => n.id)), [visibleNodes]);
  const visibleEdges = useMemo(() => edges.filter(e => visibleIds.has(e.source) && visibleIds.has(e.target)), [edges, visibleIds]);
  const graphWarnings = useMemo(() => [...new Set(visibleNodes.flatMap(n => n.data.warning ? [n.data.warning] : []))], [visibleNodes]);

  const { fitView, zoomIn, zoomOut, zoomTo, screenToFlowPosition } = useReactFlow();
  const { zoom } = useViewport();
  const initialized = useNodesInitialized();
  const focusedScope = useRef('');
  const focusedMethod = useRef('');

  useEffect(() => {
    const key = `${projectId}:${activeFilePath}:${activeMethodId}`;
    if (!initialized || !visibleNodes.length || focusedScope.current === key) return;
    const timer = setTimeout(() => {
      focusedScope.current = key;
      void fitView({ maxZoom: 0.9, padding: 0.25, duration: 150 });
    }, 80);
    return () => clearTimeout(timer);
  }, [initialized, projectId, activeFilePath, activeMethodId, visibleNodes, fitView]);

  useEffect(() => {
    if (!focusNodeRequest || !visibleIds.has(focusNodeRequest.nodeId)) return;
    const key = `${focusNodeRequest.nodeId}:${focusNodeRequest.nonce}`;
    if (focusedMethod.current === key) return;
    const timer = setTimeout(() => { focusedMethod.current = key; void fitView({ nodes: [{ id: focusNodeRequest.nodeId }], padding: 0.6, duration: 250, maxZoom: 0.9 }); }, 80);
    return () => clearTimeout(timer);
  }, [focusNodeRequest, visibleIds, fitView]);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const nodeTypes = useMemo(
    () => ({
      methodNode: MethodNode as React.ComponentType<any>,
      variableNode: VariableNode as React.ComponentType<any>,
      conditionNode: ConditionNode as React.ComponentType<any>,
      loopNode: LoopNode as React.ComponentType<any>,
      operationNode: OperationNode as React.ComponentType<any>,
      returnNode: ReturnNode as React.ComponentType<any>,
    }),
    []
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      selectNode(node.id);
      setContextMenu(null);
    },
    [selectNode]
  );

  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setEditingNode(node as Node<VisualBlockData>);
      setContextMenu(null);
    },
    [setEditingNode]
  );

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      selectNode(node.id);
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        node: node as Node<VisualBlockData>,
      });
    },
    [selectNode]
  );

  const onPaneClick = useCallback(() => {
    selectNode(null);
    setContextMenu(null);
  }, [selectNode]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const blockType = event.dataTransfer.getData('application/javascope-block') as BlockType;
      if (!blockType) return;
      const customCode = event.dataTransfer.getData('application/javascope-code');

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      addNode(blockType, position, customCode || undefined);
    },
    [screenToFlowPosition, addNode]
  );

  const isValidConnection = useCallback(
    (connection: any) => {
      if (!connection.source || !connection.target) return false;
      if (connection.source === connection.target) return false;
      const sNode = nodes.find(n => n.id === connection.source);
      const tNode = nodes.find(n => n.id === connection.target);
      if (!sNode || !tNode) return false;
      if (sNode.data.methodId && tNode.data.methodId && sNode.data.methodId !== tNode.data.methodId) {
        return false;
      }
      return true;
    },
    [nodes]
  );

  const isLight = theme === 'light';


  return (
    <div
      className={styles.canvasContainer}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={() => setContextMenu(null)}
    >
      {/* Method Navigation & Graph Notices */}
      <div className={styles.methodNavigation}>
        <label htmlFor="graph-method">Метод</label>
        <input aria-label="Поиск метода" placeholder="Найти метод…" value={methodSearch} onChange={e => setMethodSearch(e.target.value)} />
        <select id="graph-method" aria-label="Метод схемы" value={activeMethodId} onChange={e => { setActiveMethodId(e.target.value); setMethodSearch(''); }}>
          <option value="all">Весь файл — обзор</option>
          <option value="members">Поля класса</option>
          {methods.filter(n => n.id === activeMethodId || `${n.data.title} ${n.data.containerName ?? ''}`.toLowerCase().includes(methodSearch.toLowerCase())).map(n => <option key={n.id} value={n.id}>{n.data.title} — {n.data.containerName ?? ''} · L{n.data.line}</option>)}
        </select>
        <span>{visibleNodes.length} / {nodes.filter(n => n.data.source?.file === activeFilePath).length} блоков файла</span>
        <button type="button" onClick={() => { resetGraphLayout(); setTimeout(() => void fitView({ padding: 0.25, duration: 150, maxZoom: 0.9 }), 50); }}>Автораскладка</button>
      </div>
      {codeGeneratedNotice && (
        <div role="status" className={styles.codeGeneratedNotice}>
          <span>⚡ {codeGeneratedNotice}</span>
          <button type="button" onClick={clearCodeGeneratedNotice} className={styles.noticeCloseBtn} title="Закрыть">✕</button>
        </div>
      )}
      {dirty && <p role="status" className={styles.graphNotice}>Java-код изменён. На схеме последняя успешно разобранная версия; после исправления ошибок она обновится.</p>}
      {graphWarnings.length > 0 && <details className={styles.graphNotice}><summary>Ограничения схемы этого метода ({graphWarnings.length})</summary>{graphWarnings.map(warning => <p key={warning}>{warning}</p>)}</details>}

      {/* Main Workspace Graph View */}
      <div className={styles.viewsContent}>
        <div className={styles.graphView}>
          <ReactFlow
            nodes={visibleNodes}
            edges={visibleEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onReconnect={onReconnect}
            edgesReconnectable={true}
            reconnectRadius={25}
            isValidConnection={isValidConnection}
            nodeTypes={nodeTypes}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onNodeContextMenu={onNodeContextMenu}
            onPaneClick={onPaneClick}
            deleteKeyCode={methodDialog || editingNode ? null : 'Backspace'}
            defaultViewport={{ x: 80, y: 30, zoom: 0.9 }}
            minZoom={0.005}
            maxZoom={1.8}
            panOnScroll
            zoomOnScroll={false}
            fitViewOptions={{ padding: 0.25 }}
            proOptions={{ hideAttribution: true }}
            colorMode={isLight ? 'light' : 'dark'}
          >
            <Background
              color={isLight ? '#E5E7EB' : '#1E2638'}
              gap={20}
              size={1}
              variant={BackgroundVariant.Lines}
            />
          </ReactFlow>

          {/* Floating Zoom & Fit Controls in top-right corner of graph canvas (15px offset) */}
          <div className={styles.canvasControlsPill}>
            <button className={styles.pillBtn} onClick={() => zoomIn()} title="Увеличить">
              <ZoomIn size={14} />
            </button>
            <button className={styles.pillBtn} onClick={() => zoomOut()} title="Уменьшить">
              <ZoomOut size={14} />
            </button>
            <span
              className={styles.zoomText}
              onClick={() => zoomTo(1)}
              style={{ cursor: 'pointer' }}
              title="Сбросить масштаб к 100%"
            >
              {zoom < 0.1 ? (zoom * 100).toFixed(1) : Math.round(zoom * 100)}%
            </span>
            <button
              className={styles.pillBtn}
              onClick={() => fitView({ duration: 300, padding: 0.25 })}
              title="Вписать в экран"
            >
              <Maximize2 size={13} />
            </button>
          </div>

          {!visibleNodes.length && <div className={styles.emptyGraph}>В этом разделе нет блоков. Выберите метод или добавьте новый через панель слева.</div>}
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className={styles.contextMenu}
          role="menu"
          aria-label="Действия блока"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" role="menuitem" disabled={!contextMenu.node.data.editable?.some(op => ['replaceMethod', 'updateCondition', 'updateExpression', 'updateVariable', 'replaceStatement'].includes(op))}
            className={styles.contextMenuItem}
            onClick={() => {
              setEditingNode(contextMenu.node);
              setContextMenu(null);
            }}
          >
            <Edit3 size={13} />
            <span>Редактировать</span>
          </button>

          <button type="button" role="menuitem" disabled={!contextMenu.node.data.editable?.some(op => ['duplicateMethod', 'duplicateBlock'].includes(op))}
            className={styles.contextMenuItem}
            onClick={() => {
              duplicateNode(contextMenu.node.id);
              setContextMenu(null);
            }}
          >
            <Copy size={13} />
            <span>Дублировать</span>
          </button>

          <button type="button" role="menuitem"
            className={styles.contextMenuItem}
            onClick={() => {
              openNodeSource(contextMenu.node.id);
              setContextMenu(null);
            }}
          >
            <ArrowUpRight size={13} />
            <span>Открыть Java-код</span>
          </button>

          <div className={styles.contextDivider} />

          <button type="button" role="menuitem" disabled={!contextMenu.node.data.editable?.some(op => ['deleteMethod', 'deleteBlock'].includes(op))}
            className={`${styles.contextMenuItem} ${styles.danger}`}
            onClick={() => {
              deleteNode(contextMenu.node.id);
              setContextMenu(null);
            }}
          >
            <Trash2 size={13} />
            <span>Удалить блок</span>
          </button>
        </div>
      )}

      {/* Node Editing Modal */}
      <NodeEditModal />
    </div>
  );
};

export const VisualCanvas: React.FC = () => {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
};
