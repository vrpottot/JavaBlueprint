import { useState, useRef } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Search,
  GripVertical,
  Code2,
  Box,
  GitFork,
  RefreshCw,
  Plus,
  CornerDownLeft,
  FilePlus,
  ShieldAlert,
  Terminal,
  Layers,
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { PALETTE_ITEMS } from '../../lib/palette';
import type { FileItem, BlockPaletteItem } from '../../types';
import styles from './ProjectExplorer.module.scss';

export const ProjectExplorer: React.FC = () => {
  const files = useProjectStore((s) => s.files);
  const activeFileId = useProjectStore((s) => s.activeFileId);
  const selectFile = useProjectStore((s) => s.selectFile);
  const addNode = useProjectStore((s) => s.addNode);
  const importJavaFiles = useProjectStore((s) => s.importJavaFiles);
  const addFileInputRef = useRef<HTMLInputElement>(null);

  const handleAddFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploaded = Array.from(e.target.files || []);
    if (uploaded.length === 0) return;
    try {
      const parsedFiles = await Promise.all(
        uploaded.map(async (f) => ({ path: f.name, content: await f.text() }))
      );
      await importJavaFiles(parsedFiles, false);
    } catch (err) {
      console.error('Ошибка добавления файлов:', err);
    } finally {
      if (addFileInputRef.current) {
        addFileInputRef.current.value = '';
      }
    }
  };

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

  const filteredPalette = PALETTE_ITEMS.filter((item: BlockPaletteItem) =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getBlockIcon = (item: BlockPaletteItem) => {
    if (item.category === 'Исключения') {
      return (
        <div className={`${styles.blockIconBadge} ${styles.badgeReturn}`}>
          <ShieldAlert size={14} />
        </div>
      );
    }
    if (item.category === 'Консольный ввод-вывод') {
      return (
        <div className={`${styles.blockIconBadge} ${styles.badgeOperation}`}>
          <Terminal size={14} />
        </div>
      );
    }
    if (item.category === 'Коллекции java.util') {
      return (
        <div className={`${styles.blockIconBadge} ${styles.badgeVariable}`}>
          <Layers size={14} />
        </div>
      );
    }
    switch (item.type) {
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
      case 'return':
        return (
          <div className={`${styles.blockIconBadge} ${styles.badgeReturn}`}>
            <CornerDownLeft size={14} />
          </div>
        );
      default:
        return (
          <div className={`${styles.blockIconBadge} ${styles.badgeOperation}`}>
            <Plus size={14} />
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
              {isDir && (
                <span className={styles.chevron}>
                  {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </span>
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
            <span className={styles.headerTitle}>Проект</span>
          </div>
          <div className={styles.headerActions}>
            <input
              type="file"
              ref={addFileInputRef}
              multiple
              accept=".java"
              style={{ display: 'none' }}
              onChange={handleAddFiles}
            />
            <button
              className={styles.headerActionBtn}
              onClick={() => addFileInputRef.current?.click()}
              title="Добавить .java файл в проект (сохраняя текущие)"
            >
              <FilePlus size={14} />
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
              key={item.id ?? item.name}
              role="button"
              tabIndex={0}
              aria-label={`Добавить блок ${item.name}`}
              className={styles.blockCard}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/javascope-block', item.type);
                if (item.defaultCode) e.dataTransfer.setData('application/javascope-code', item.defaultCode);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onClick={() => addNode(item.type, undefined, item.defaultCode)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void addNode(item.type, undefined, item.defaultCode); } }}
              title={`[${item.category ?? 'Блок'}] ${item.name}\n${item.description}\n\n${item.defaultCode || ''}`}
            >
              <div className={styles.cardLeft}>
                {getBlockIcon(item)}
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
