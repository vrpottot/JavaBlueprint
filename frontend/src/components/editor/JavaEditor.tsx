import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { editor } from 'monaco-editor';
import Editor, { type Monaco } from '@monaco-editor/react';
import { Copy, Check, FileCode } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import styles from './JavaEditor.module.scss';

interface JavaEditorProps {
  hideHeader?: boolean;
}

export const JavaEditor: React.FC<JavaEditorProps> = ({ hideHeader = false }) => {
  const theme = useProjectStore((s) => s.theme);
  const javaCode = useProjectStore((s) => s.javaCode);
  const updateJavaCode = useProjectStore((s) => s.updateJavaCode);
  const activeFilePath = useProjectStore((s) => s.activeFilePath);
  const codeViewMode = useProjectStore((s) => s.codeViewMode);
  const setCodeViewMode = useProjectStore((s) => s.setCodeViewMode);
  const isLoading = useProjectStore((s) => s.isLoading);
  const isCompiling = useProjectStore((s) => s.isCompiling);
  const isOptimized = useProjectStore((s) => s.isOptimized);
  const selected = useProjectStore(s => s.nodes.find(node => node.id === s.selectedNodeId));
  const tab = useProjectStore(s => s.mainWorkspaceTab);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const selectedLine = !(codeViewMode === 'source' && isOptimized) && selected?.data.source?.file === activeFilePath ? selected.data.source.startLine : null;
  const reveal = useCallback(() => { if (selectedLine) { editorRef.current?.revealLineInCenter(selectedLine); editorRef.current?.setPosition({ lineNumber: selectedLine, column: 1 }); } }, [selectedLine]);
  useEffect(() => {
    if (tab !== 'editor') return;
    const timer = setTimeout(reveal, 50);
    return () => clearTimeout(timer);
  }, [reveal, tab, activeFilePath, codeViewMode]);

  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(javaCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleEditorWillMount = (monaco: Monaco) => {
    // Dark IDE Theme
    monaco.editor.defineTheme('javascope-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '5E6D82', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'A879F8', fontStyle: 'bold' },
        { token: 'string', foreground: '39C98A' },
        { token: 'number', foreground: 'F4A34B' },
        { token: 'type', foreground: '4294F7' },
        { token: 'identifier', foreground: 'E6EDF7' },
      ],
      colors: {
        'editor.background': '#0B111B',
        'editor.foreground': '#E6EDF7',
        'editorLineNumber.foreground': '#344357',
        'editorLineNumber.activeForeground': '#8D9BAF',
        'editor.selectionBackground': '#253347',
        'editor.lineHighlightBackground': '#111824',
        'editorCursor.foreground': '#4294F7',
        'scrollbarSlider.background': 'rgba(37, 51, 71, 0.4)',
        'scrollbarSlider.hoverBackground': 'rgba(52, 67, 87, 0.6)',
      },
    });

    // Light IDE Theme (from reference photo)
    monaco.editor.defineTheme('javascope-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '94A3B8', fontStyle: 'italic' },
        { token: 'keyword', foreground: '9333EA', fontStyle: 'bold' },
        { token: 'string', foreground: '16A34A' },
        { token: 'number', foreground: 'EA580C' },
        { token: 'type', foreground: '2563EB' },
        { token: 'identifier', foreground: '0F172A' },
      ],
      colors: {
        'editor.background': '#FFFFFF',
        'editor.foreground': '#0F172A',
        'editorLineNumber.foreground': '#94A3B8',
        'editorLineNumber.activeForeground': '#475569',
        'editor.selectionBackground': '#E2E8F0',
        'editor.lineHighlightBackground': '#F8FAFC',
        'editorCursor.foreground': '#2563EB',
        'scrollbarSlider.background': 'rgba(203, 213, 225, 0.4)',
        'scrollbarSlider.hoverBackground': 'rgba(148, 163, 184, 0.6)',
      },
    });
  };

  return (
    <div className={styles.editorContainer}>
      {!hideHeader && (
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <FileCode size={13} color="var(--accent-blue)" />
            <span className={styles.fileName}>{activeFilePath.split('/').pop()}</span>
          </div>

          <div className={styles.headerRight}>
            <div className={styles.toggleGroup}>
              <button
                className={`${styles.toggleBtn} ${codeViewMode === 'source' ? styles.active : ''}`}
                onClick={() => setCodeViewMode('source')}
              >
                Исходный
              </button>
              <button
                className={`${styles.toggleBtn} ${codeViewMode === 'optimized' ? styles.active : ''}`}
                onClick={() => setCodeViewMode('optimized')}
              >
                {isOptimized ? 'Текущий' : 'Оптимизированный'}
              </button>
            </div>

            <button
              className={`${styles.actionBtn} ${copied ? styles.success : ''}`}
              onClick={handleCopy}
              title="Копировать код в буфер"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              <span>{copied ? 'Скопировано' : 'Копировать'}</span>
            </button>
          </div>
        </div>
      )}

      <div className={styles.monacoWrapper}>
        <Editor
          height="100%"
          language="java"
          theme={theme === 'light' ? 'javascope-light' : 'javascope-dark'}
          value={javaCode}
          path={activeFilePath}
          onMount={instance => { editorRef.current = instance; reveal(); }}
          beforeMount={handleEditorWillMount}
          onChange={(val) => updateJavaCode(val || '')}
          options={{
            readOnly: isLoading || isCompiling || (codeViewMode === 'source' && isOptimized),
            fontSize: 12,
            fontFamily: "'JetBrains Mono', Consolas, monospace",
            lineHeight: 20,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            automaticLayout: true,
            tabSize: 4,
            renderLineHighlight: 'all',
            padding: { top: 8, bottom: 8 },
            smoothScrolling: true,
            cursorBlinking: 'smooth',
          }}
        />
      </div>
    </div>
  );
};
