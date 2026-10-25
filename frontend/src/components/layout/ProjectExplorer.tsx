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
  Trash2,
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { PALETTE_ITEMS } from '../../lib/palette';
import type { FileItem, BlockPaletteItem } from '../../types';
import styles from './ProjectExplorer.module.scss';

export const ProjectTreePanel: React.FC = () => {
  const files = useProjectStore((s) => s.files);
  const activeFileId = useProjectStore((s) => s.activeFileId);
  const selectFile = useProjectStore((s) => s.selectFile);
  const deleteFile = useProjectStore((s) => s.deleteFile);
  const importJavaFiles = useProjectStore((s) => s.importJavaFiles);
  const issues = useProjectStore((s) => s.issues);
  const addFileInputRef = useRef<HTMLInputElement>(null);

  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('javablueprint_expanded_folders');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      'f-src': true,
      'f-com-example': true,
      'f-model': false,
      'f-util': false,
    };
  });

  const toggleFolder = (folderId: string) => {
    setExpandedFolders((prev) => {
      const next = {
        ...prev,
        [folderId]: !prev[folderId],
      };
      try {
        localStorage.setItem('javablueprint_expanded_folders', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

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

  const renderFileTree = (items: FileItem[], depth = 0) => {
    const canDelete = files.length > 1;

    return items.map((item) => {
      const isDir = item.type === 'directory';
      const isExpanded = expandedFolders[item.id];
      const isActive = activeFileId === item.id;
      const itemIssues = issues.filter(
        (issue) => issue.file === item.path || issue.file.endsWith(item.path) || item.path.endsWith(issue.file)
      );
      const issuesCount = item.issueCount || itemIssues.length;

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
            title={isDir ? item.name : `${item.name} (${item.path})`}
          >
            <div className={styles.itemLabel}>
              {isDir ? (
                <span className={styles.chevron}>
                  {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </span>
              ) : (
                <span className={styles.javaFileIcon}>Ja</span>
              )}
              <span className={styles.fileNameText}>{item.name}</span>
            </div>

            <div className={styles.itemActions}>
              {issuesCount > 0 && (
                <span className={styles.issueDot} title={`Обнаружены проблемы в коде (${issuesCount})`}>
                  {issuesCount}
                </span>
              )}

              {!isDir && (
                <button
                  type="button"
                  className={styles.deleteFileBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!canDelete) {
                      alert('Нельзя удалить единственный файл проекта. В проекте должен оставаться хотя бы один файл исходного кода.');
                      return;
                    }
                    if (window.confirm(`Вы действительно хотите удалить файл "${item.name}" из проекта?`)) {
                      void deleteFile(item.path);
                    }
                  }}
                  title={canDelete ? `Удалить файл "${item.name}"` : 'Нельзя удалить единственный файл проекта'}
                  aria-label={`Удалить ${item.name}`}
                  disabled={!canDelete}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>

          {isDir && isExpanded && item.children && (
            <div role="group">{renderFileTree(item.children, depth + 1)}</div>
          )}
        </div>
      );
    });
  };

  return (
    <div className={styles.standalonePanel}>
      <div className={styles.sectionHeader}>
        <div className={styles.headerLeft}>
          <span className={styles.headerTitle}>Файлы проекта</span>
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
  );
};

export const BlockPalettePanel: React.FC = () => {
  const addNode = useProjectStore((s) => s.addNode);
  const [searchQuery, setSearchQuery] = useState('');

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

  return (
    <div className={`${styles.standalonePanel} ${styles.blocksSection}`}>
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
  );
};

export const ProjectExplorer: React.FC = () => {
  return (
    <aside className={styles.sidebar}>
      <ProjectTreePanel />
      <div className={styles.divider} />
      <BlockPalettePanel />
    </aside>
  );
};
