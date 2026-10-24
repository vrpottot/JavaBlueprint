import React, { useState, useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  useReactFlow,
  ReactFlowProvider,
  type Node,
} from '@xyflow/react';
import {
  Maximize2,
  ZoomIn,
  ZoomOut,
  X,
  Plus,
  FileCode,
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

interface ContextMenuState {
  x: number;
  y: number;
  node: Node<VisualBlockData>;
}

const CanvasInner: React.FC = () => {
  const theme = useProjectStore((s) => s.theme);
  const activeFilePath = useProjectStore((s) => s.activeFilePath);
  const nodes = useProjectStore((s) => s.nodes);
  const edges = useProjectStore((s) => s.edges);
  const onNodesChange = useProjectStore((s) => s.onNodesChange);
  const onEdgesChange = useProjectStore((s) => s.onEdgesChange);
  const selectNode = useProjectStore((s) => s.selectNode);
  const setEditingNode = useProjectStore((s) => s.setEditingNode);
  const addNode = useProjectStore((s) => s.addNode);
  const duplicateNode = useProjectStore((s) => s.duplicateNode);
  const deleteNode = useProjectStore((s) => s.deleteNode);

  const { fitView, zoomIn, zoomOut, zoomTo, screenToFlowPosition } = useReactFlow();

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

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      addNode(blockType, position);
    },
    [screenToFlowPosition, addNode]
  );

  const isLight = theme === 'light';

  return (
    <div
      className={styles.canvasContainer}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={() => setContextMenu(null)}
    >
      {/* Top Floating Bar matching reference photo */}
      <div className={styles.canvasTopBar}>
        <div className={styles.fileTabsGroup}>
          <div className={styles.fileTab}>
            <FileCode size={13} color="var(--accent-blue)" />
            <span>{activeFilePath.split('/').pop()}</span>
            <span className={styles.tabCloseBtn}>
              <X size={12} />
            </span>
          </div>

          <button className={styles.addTabBtn} title="Новый таб">
            <Plus size={13} />
          </button>
        </div>

        {/* Floating pill zoom controls matching screenshot */}
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
            100%
          </span>
          <button
            className={styles.pillBtn}
            onClick={() => fitView({ duration: 300, padding: 0.25 })}
            title="Вписать в экран"
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={onPaneClick}
        defaultViewport={{ x: 80, y: 30, zoom: 0.9 }}
        minZoom={0.3}
        maxZoom={1.8}
        fitViewOptions={{ padding: 0.25 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          color={isLight ? '#CBD5E1' : '#2A3647'}
          gap={20}
          size={1}
          variant={BackgroundVariant.Dots}
        />
      </ReactFlow>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className={styles.contextMenu}
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className={styles.contextMenuItem}
            onClick={() => {
              setEditingNode(contextMenu.node);
              setContextMenu(null);
            }}
          >
            <Edit3 size={13} />
            <span>Редактировать</span>
          </div>

          <div
            className={styles.contextMenuItem}
            onClick={() => {
              duplicateNode(contextMenu.node.id);
              setContextMenu(null);
            }}
          >
            <Copy size={13} />
            <span>Дублировать</span>
          </div>

          <div
            className={styles.contextMenuItem}
            onClick={() => {
              selectNode(contextMenu.node.id);
              setContextMenu(null);
            }}
          >
            <ArrowUpRight size={13} />
            <span>Выделить блок</span>
          </div>

          <div className={styles.contextDivider} />

          <div
            className={`${styles.contextMenuItem} ${styles.danger}`}
            onClick={() => {
              deleteNode(contextMenu.node.id);
              setContextMenu(null);
            }}
          >
            <Trash2 size={13} />
            <span>Удалить блок</span>
          </div>
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
