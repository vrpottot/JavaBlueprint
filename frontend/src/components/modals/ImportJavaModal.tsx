import React, { useState, useRef } from 'react';
import { Upload, X, FileCode, Check } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import styles from './ImportJavaModal.module.scss';

export const ImportJavaModal: React.FC = () => {
  const showImportModal = useProjectStore((s) => s.showImportModal);
  const setShowImportModal = useProjectStore((s) => s.setShowImportModal);
  const importJavaFile = useProjectStore((s) => s.importJavaFile);

  const [filename, setFilename] = useState('PaymentGateway.java');
  const [content, setContent] = useState(`package com.example;

import java.util.List;

public class PaymentGateway {

    public boolean processPayment(double amount, String currency) {
        if (amount <= 0) {
            return false;
        }
        // Вызов платежного провайдера
        return true;
    }
}
`);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!showImportModal) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) setContent(text);
    };
    reader.readAsText(file);
  };

  const handleImport = () => {
    if (!filename.trim()) return;
    importJavaFile(filename.trim(), content);
  };

  return (
    <div className={styles.modalOverlay} onClick={() => setShowImportModal(false)}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileCode size={16} color="#4294F7" />
            <span>Импорт исходного файла Java (.java)</span>
          </div>
          <button className={styles.closeBtn} onClick={() => setShowImportModal(false)}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.dropZone} onClick={() => fileInputRef.current?.click()}>
            <Upload size={24} color="#4294F7" />
            <div className={styles.dropTitle}>Нажмите или перетащите .java файл сюда</div>
            <div className={styles.dropSub}>Поддерживаются Java 17, 21+ исходные файлы</div>
            <input
              type="file"
              ref={fileInputRef}
              accept=".java"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.label}>Имя файла</label>
            <input
              type="text"
              className={styles.input}
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="ClassName.java"
            />
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.label}>Исходный код</label>
            <textarea
              className={styles.textarea}
              rows={8}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="package com.example; ..."
            />
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button className={styles.cancelBtn} onClick={() => setShowImportModal(false)}>
            Отмена
          </button>
          <button className={styles.submitBtn} onClick={handleImport}>
            <Check size={14} />
            <span>Импортировать в проект</span>
          </button>
        </div>
      </div>
    </div>
  );
};
