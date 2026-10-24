import { useState } from 'react';
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Search,
  GripVertical,
  Crosshair,
  MoreVertical,
  Code2,
  Box,
  GitFork,
  RefreshCw,
  Plus,
  CornerDownLeft,
  Layers,
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { PALETTE_ITEMS } from '../../lib/demo-data';
import type { FileItem, BlockType } from '../../types';
import styles from './ProjectExplorer.module.scss';

export const ProjectExplorer: React.FC = () => {
  const files = useProjectStore((s) => s.files);
  const activeFileId = useProjectStore((s) => s.activeFileId);
  const selectFile = useProjectStore((s) => s.selectFile);
  const addNode = useProjectStore((s) => s.addNode);

  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    'f-src': true,
    'f-com-example': true,
    'f-model': false,
    'f-util': false,
  });

  const [searchQuery, setSearchQuery] = useState('');

  const toggleFolder = (folderId: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderId]: !prev[folderId],
    }));
  };

  const filteredPalette = PALETTE_ITEMS.filter((item) =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getBlockIcon = (type: BlockType) => {
    switch (type) {
      case 'variable':
        return (
          <div className={`${styles.blockIconBadge} ${styles.badgeVariable}`}>
            <Box size={14} />
          </div>
        );
      case 'condition':
        return (
          <div className={`${styles.blockIconBadge} ${styles.badgeCondition}`}>
            <GitFork size={14} />
          </div>
        );
      case 'loop':
        return (
          <div className={`${styles.blockIconBadge} ${styles.badgeLoop}`}>
            <RefreshCw size={14} />
          </div>
        );
      case 'method':
        return (
          <div className={`${styles.blockIconBadge} ${styles.badgeMethod}`}>
            <Code2 size={14} />
          </div>
        );
      case 'operation':
        return (
          <div className={`${styles.blockIconBadge} ${styles.badgeOperation}`}>
            <Plus size={14} />
          </div>
        );
      case 'return':
        return (
          <div className={`${styles.blockIconBadge} ${styles.badgeReturn}`}>
            <CornerDownLeft size={14} />
          </div>
        );
    }
  };

  const renderFileTree = (items: FileItem[], depth = 0) => {
    return items.map((item) => {
      const isDir = item.type === 'directory';
      const isExpanded = expandedFolders[item.id];
      const isActive = activeFileId === item.id;

      return (
        <div key={item.id} className={styles.treeNode}>
          <div
            className={`${styles.treeItem} ${isActive ? styles.active : ''}`}
            style={{ paddingLeft: `${depth * 14 + 10}px` }}
            onClick={() => {
              if (isDir) {
                toggleFolder(item.id);
              } else {
                selectFile(item.id);
              }
            }}
            role="treeitem"
            aria-selected={isActive}
          >
            <div className={styles.itemLabel}>
              {isDir ? (
                <>
                  <span className={styles.chevron}>
                    {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </span>
                  <span className={styles.folderIcon}>
                    {isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />}
                  </span>
                </>
              ) : (
                <>
                  <span className={styles.treeIndentSpacer} />
                  <div className={styles.javaFileIcon}>
                    <span>Ja</span>
                  </div>
                </>
              )}
              <span className={styles.fileNameText}>{item.name}</span>
            </div>

            {item.hasIssues && (
              <span className={styles.issueDot} title={`Обнаружены проблемы в коде (${item.issueCount})`}>
                {item.issueCount || '!'}
              </span>
            )}
          </div>

          {isDir && isExpanded && item.children && (
            <div role="group">{renderFileTree(item.children, depth + 1)}</div>
          )}
        </div>
      );
    });
  };

  return (
    <aside className={styles.sidebar}>
      {/* Top Section: Проект */}
      <div className={styles.projectSection}>
        <div className={styles.sectionHeader}>
          <div className={styles.headerLeft}>
            <Layers size={14} className={styles.headerIcon} />
            <span className={styles.headerTitle}>Проект</span>
          </div>
          <div className={styles.headerActions}>
            <button className={styles.headerActionBtn} title="Сфокусировать текущий файл">
              <Crosshair size={14} />
            </button>
            <button className={styles.headerActionBtn} title="Дополнительные действия">
              <MoreVertical size={14} />
            </button>
          </div>
        </div>

        <div className={styles.treeContainer} role="tree">
          {renderFileTree(files)}
        </div>
      </div>

      {/* Horizontal Divider */}
      <div className={styles.divider} />

      {/* Bottom Section: Блоки */}
      <div className={styles.blocksSection}>
        <div className={styles.blocksHeader}>
          <span className={styles.blocksTitle}>Блоки</span>
        </div>

        <div className={styles.searchBox}>
          <Search size={14} className={styles.searchIcon} />
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Поиск блоков..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className={styles.blockList}>
          {filteredPalette.map((item) => (
            <div
              key={item.type}
              className={styles.blockCard}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/javascope-block', item.type);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onClick={() => addNode(item.type)}
              title={`Перетащите или кликните для добавления:\n${item.description}`}
            >
              <div className={styles.cardLeft}>
                {getBlockIcon(item.type)}
                <span className={styles.cardName}>{item.name}</span>
              </div>

              <div className={styles.cardRight}>
                <GripVertical size={14} className={styles.dragIcon} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
};
