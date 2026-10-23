import { useState } from 'react';
import {
  Folder,
  FolderOpen,
  FileCode,
  ChevronRight,
  ChevronDown,
  Search,
  Plus,
  GripVertical,
  Code,
  Database,
  GitFork,
  RefreshCw,
  PlusCircle,
  CornerDownLeft,
  FilePlus,
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
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getBlockIcon = (type: BlockType) => {
    switch (type) {
      case 'method':
        return (
          <div style={{ backgroundColor: '#F3E8FF', padding: 4, borderRadius: 4, display: 'flex' }}>
            <Code size={14} color="#9333EA" />
          </div>
        );
      case 'variable':
        return (
          <div style={{ backgroundColor: '#DBEAFE', padding: 4, borderRadius: 4, display: 'flex' }}>
            <Database size={14} color="#2563EB" />
          </div>
        );
      case 'condition':
        return (
          <div style={{ backgroundColor: '#FFEDD5', padding: 4, borderRadius: 4, display: 'flex' }}>
            <GitFork size={14} color="#EA580C" />
          </div>
        );
      case 'loop':
        return (
          <div style={{ backgroundColor: '#F3E8FF', padding: 4, borderRadius: 4, display: 'flex' }}>
            <RefreshCw size={14} color="#9333EA" />
          </div>
        );
      case 'operation':
        return (
          <div style={{ backgroundColor: '#DCFCE7', padding: 4, borderRadius: 4, display: 'flex' }}>
            <PlusCircle size={14} color="#16A34A" />
          </div>
        );
      case 'return':
        return (
          <div style={{ backgroundColor: '#FEE2E2', padding: 4, borderRadius: 4, display: 'flex' }}>
            <CornerDownLeft size={14} color="#DC2626" />
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
        <div key={item.id}>
          <div
            className={`${styles.treeItem} ${isActive ? styles.active : ''}`}
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
            onClick={() => {
              if (isDir) {
                toggleFolder(item.id);
              } else {
                selectFile(item.id);
              }
            }}
          >
            <div className={styles.itemLabel}>
              {isDir ? (
                <>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </span>
                  <span className={styles.itemIcon}>
                    {isExpanded ? (
                      <FolderOpen size={14} color="#60A5FA" />
                    ) : (
                      <Folder size={14} color="#60A5FA" />
                    )}
                  </span>
                </>
              ) : (
                <>
                  <span style={{ width: 12 }} />
                  <span className={styles.itemIcon}>
                    <FileCode size={14} color={isActive ? '#2563EB' : '#94A3B8'} />
                  </span>
                </>
              )}
              <span>{item.name}</span>
            </div>

            {item.hasIssues && (
              <span className={styles.issueDot} title="Обнаружены проблемы в коде">
                {item.issueCount || '!'}
              </span>
            )}
          </div>

          {isDir && isExpanded && item.children && (
            <div>{renderFileTree(item.children, depth + 1)}</div>
          )}
        </div>
      );
    });
  };

  return (
    <aside className={styles.explorer}>
      {/* Top Card: Project Tree */}
      <div className={styles.projectCard}>
        <div className={styles.sectionHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Folder size={14} color="var(--accent-blue)" />
            <span>Project</span>
          </div>
          <div className={styles.headerActions}>
            <span className={styles.actionIcon} title="Новый файл">
              <FilePlus size={13} />
            </span>
          </div>
        </div>

        <div className={styles.treeContainer}>{renderFileTree(files)}</div>
      </div>

      {/* Bottom Card: Blocks Palette */}
      <div className={styles.paletteCardSection}>
        <div className={styles.sectionHeader}>
          <span>Blocks</span>
        </div>

        <div className={styles.searchBox}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search
              size={12}
              color="var(--text-muted)"
              style={{ position: 'absolute', left: 7, pointerEvents: 'none' }}
            />
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Поиск блока"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.paletteList}>
          {filteredPalette.map((item) => (
            <div
              key={item.type}
              className={styles.paletteCard}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/javascope-block', item.type);
                e.dataTransfer.effectAllowed = 'move';
              }}
              title={`Перетащите на холст:\n${item.description}`}
            >
              <div className={styles.cardLeft}>
                {getBlockIcon(item.type)}
                <span className={styles.cardName}>{item.name}</span>
              </div>

              <div className={styles.cardRight}>
                <button
                  className={styles.addBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    addNode(item.type);
                  }}
                  title="Добавить на canvas"
                >
                  <Plus size={12} />
                </button>
                <GripVertical size={12} color="var(--text-muted)" style={{ cursor: 'grab' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
};
