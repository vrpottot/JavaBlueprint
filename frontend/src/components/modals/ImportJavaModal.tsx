import React, { useState, useRef } from 'react';
import { Upload, X, FileCode, Check, FolderPlus, Folder, FileText } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { normalizeRelativePath, getFilesFromDataTransfer } from '../../lib/file-tree';
import styles from './ImportJavaModal.module.scss';

export const ImportJavaModal: React.FC = () => {
  const showImportModal = useProjectStore((s) => s.showImportModal);
  const setShowImportModal = useProjectStore((s) => s.setShowImportModal);
  const importJavaFile = useProjectStore((s) => s.importJavaFile);
  const importJavaFiles = useProjectStore((s) => s.importJavaFiles);
  const isLoading = useProjectStore((s) => s.isLoading);
  const error = useProjectStore((s) => s.error);
  const [fileError, setFileError] = useState<string | null>(null);
  const [keepExisting, setKeepExisting] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState(false);

  // For multi-file / folder stage
  const [stagedFiles, setStagedFiles] = useState<Array<{ path: string; content: string }>>([]);

  const [filename, setFilename] = useState('Main.java');
  const [content, setContent] = useState(`package com.example;

import java.util.List;

public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, JavaBlueprint!");
    }
}
`);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  if (!showImportModal) return null;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const uploaded = Array.from(e.target.files || []);
    if (uploaded.length === 0) return;

    if (uploaded.length > 1) {
      try {
        const parsed = await Promise.all(
          uploaded.map(async (f) => ({
            path: normalizeRelativePath((f as any).webkitRelativePath || f.name),
            content: await f.text(),
          }))
        );
        setStagedFiles(parsed);
      } catch {
        setFileError('Не удалось прочитать выбранные файлы.');
      }
      return;
    }

    const file = uploaded[0];
    if (!file) return;

    setStagedFiles([]);
    setFilename(file.name);
    try {
      const text = await file.text();
      setContent(text);
    } catch {
      setFileError('Не удалось прочитать файл. Выберите его повторно.');
    }
  };

  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const rawFiles = Array.from(e.target.files || []);
    if (rawFiles.length === 0) return;

    const javaFiles = rawFiles.filter((f) => f.name.endsWith('.java'));
    if (javaFiles.length === 0) {
      setFileError('В выбранной папке не найдено файлов с расширением .java');
      return;
    }

    try {
      const parsed = await Promise.all(
        javaFiles.map(async (f) => ({
          path: normalizeRelativePath((f as any).webkitRelativePath || f.name),
          content: await f.text(),
        }))
      );
      setStagedFiles(parsed);
    } catch {
      setFileError('Не удалось прочитать файлы из папки.');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setFileError(null);

    try {
      if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
        const extracted = await getFilesFromDataTransfer(e.dataTransfer.items);
        if (extracted.length === 0) {
          setFileError('Не найдено .java файлов в перетащенном объекте.');
          return;
        }
        if (extracted.length === 1) {
          setStagedFiles([]);
          setFilename(extracted[0].path);
          setContent(extracted[0].content);
        } else {
          setStagedFiles(extracted);
        }
      } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const rawFiles = Array.from(e.dataTransfer.files).filter((f) => f.name.endsWith('.java'));
        if (rawFiles.length === 0) {
          setFileError('Перетащите файлы с расширением .java');
          return;
        }
        if (rawFiles.length === 1) {
          setStagedFiles([]);
          setFilename(rawFiles[0].name);
          setContent(await rawFiles[0].text());
        } else {
          const parsed = await Promise.all(
            rawFiles.map(async (f) => ({
              path: normalizeRelativePath(f.name),
              content: await f.text(),
            }))
          );
          setStagedFiles(parsed);
        }
      }
    } catch {
      setFileError('Ошибка чтения перетащенных файлов.');
    }
  };

  const handleImport = async () => {
    if (stagedFiles.length > 0) {
      await importJavaFiles(stagedFiles, !keepExisting);
      return;
    }

    if (!filename.trim()) return;
    await importJavaFile(filename.trim(), content, !keepExisting);
  };

  return (
    <div className={styles.modalOverlay} onClick={() => setShowImportModal(false)}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileCode size={16} color="#4294F7" />
            <span>Импорт Java проекта / исходных файлов</span>
          </div>
          <button className={styles.closeBtn} onClick={() => setShowImportModal(false)}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.modalBody}>
          <div
            className={`${styles.dropZone} ${isDragging ? styles.dropZoneActive : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <Upload size={24} color="#4294F7" />
            <div className={styles.dropTitle}>
              {stagedFiles.length > 0
                ? `Выбрано файлов: ${stagedFiles.length}`
                : 'Перетащите сюда папку проекта или файлы .java'}
            </div>
            <div className={styles.dropSub}>
              Поддерживаются папки с пакетами (src/...), архивы и исходники Java 17, 21+
            </div>

            <div className={styles.buttonGroup}>
              <button
                type="button"
                className={styles.pickerBtn}
                onClick={() => folderInputRef.current?.click()}
              >
                <FolderPlus size={14} />
                <span>Выбрать папку проекта</span>
              </button>

              <button
                type="button"
                className={styles.pickerBtnSecondary}
                onClick={() => fileInputRef.current?.click()}
              >
                <FileText size={14} />
                <span>Выбрать файлы .java</span>
              </button>
            </div>

            <input
              type="file"
              ref={fileInputRef}
              accept=".java"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
            <input
              type="file"
              ref={folderInputRef}
              // @ts-expect-error webkitdirectory is standard in browsers
              webkitdirectory=""
              directory=""
              multiple
              style={{ display: 'none' }}
              onChange={handleFolderUpload}
            />
          </div>

          {stagedFiles.length > 0 ? (
            <div className={styles.stagedListSection}>
              <div className={styles.stagedHeader}>
                <span>Файлы для загрузки в проект:</span>
                <span className={styles.stagedBadge}>{stagedFiles.length} шт.</span>
              </div>
              <div className={styles.stagedList}>
                {stagedFiles.map((f, i) => (
                  <div key={i} className={styles.stagedItem}>
                    <Folder size={12} color="#8D9BAF" />
                    <span className={styles.stagedPath}>{f.path}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Имя файла / Путь</label>
                <input
                  type="text"
                  className={styles.input}
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  placeholder="src/com/example/Main.java"
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label}>Исходный код</label>
                <textarea
                  className={styles.textarea}
                  rows={7}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="package com.example; ..."
                />
              </div>
            </>
          )}

          <label className={styles.optionsRow}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={keepExisting}
              onChange={(e) => setKeepExisting(e.target.checked)}
            />
            <span className={styles.optionLabel}>
              Добавить к текущему проекту (сохранить уже открытые файлы)
            </span>
          </label>
        </div>

        <div className={styles.modalFooter}>
          <button className={styles.cancelBtn} onClick={() => setShowImportModal(false)}>
            Отмена
          </button>
          {(fileError || error) && <p className={styles.errorText} role="alert">{fileError || error}</p>}
          <button className={styles.submitBtn} onClick={handleImport} disabled={isLoading}>
            <Check size={14} />
            <span>
              {stagedFiles.length > 0
                ? `Импортировать ${stagedFiles.length} файлов`
                : 'Импортировать в проект'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
