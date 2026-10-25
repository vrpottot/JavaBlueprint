import React, { useRef, useEffect, useState } from 'react';
import { Terminal, Trash2, CornerDownLeft, Keyboard, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import styles from './ConsolePanel.module.scss';

export const ConsolePanel: React.FC = () => {
  const consoleLogs = useProjectStore((s) => s.consoleLogs);
  const clearConsole = useProjectStore((s) => s.clearConsole);
  const isRunning = useProjectStore((s) => s.isRunning);
  const isCompiling = useProjectStore((s) => s.isCompiling);
  const waitingForInput = useProjectStore((s) => s.waitingForInput);
  const runStdin = useProjectStore((s) => s.runStdin);
  const setRunStdin = useProjectStore((s) => s.setRunStdin);
  const sendConsoleInput = useProjectStore((s) => s.sendConsoleInput);
  const codeRequiresInput = useProjectStore((s) => s.codeRequiresInput);

  const [inputVal, setInputVal] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [isMultiline, setIsMultiline] = useState<boolean>(false);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on logs change
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [consoleLogs, waitingForInput]);

  // Focus input when program starts waiting for input
  useEffect(() => {
    if (waitingForInput) {
      if (isMultiline) {
        textareaRef.current?.focus();
      } else {
        inputRef.current?.focus();
      }
    }
  }, [waitingForInput, isMultiline]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const valueToSend = inputVal;
    if (isRunning || isCompiling) return;

    if (valueToSend.trim().length > 0) {
      setHistory((prev) => [valueToSend, ...prev.filter((h) => h !== valueToSend)].slice(0, 50));
    }
    setHistoryIdx(-1);

    // Keep data in the command line as requested by user, and highlight/select it
    setTimeout(() => {
      if (isMultiline) {
        textareaRef.current?.focus();
        textareaRef.current?.select();
      } else {
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }, 20);

    await sendConsoleInput(valueToSend);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (isMultiline) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void handleSubmit();
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      void handleSubmit();
      return;
    }

    if (e.key === 'ArrowUp') {
      if (history.length > 0) {
        e.preventDefault();
        const nextIdx = Math.min(historyIdx + 1, history.length - 1);
        setHistoryIdx(nextIdx);
        setInputVal(history[nextIdx] || '');
      }
    } else if (e.key === 'ArrowDown') {
      if (historyIdx > 0) {
        e.preventDefault();
        const nextIdx = historyIdx - 1;
        setHistoryIdx(nextIdx);
        setInputVal(history[nextIdx] || '');
      } else if (historyIdx === 0) {
        e.preventDefault();
        setHistoryIdx(-1);
        setInputVal('');
      }
    }
  };

  const hasScanner = codeRequiresInput();

  return (
    <div className={styles.consoleContainer}>
      {/* Header bar */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span
            className={`${styles.statusIndicator} ${
              waitingForInput
                ? styles.waiting
                : isRunning || isCompiling
                ? styles.busy
                : ''
            }`}
            title={
              waitingForInput
                ? 'Ожидание ввода данных (Scanner)'
                : isRunning || isCompiling
                ? 'Выполнение...'
                : 'Готов'
            }
          />
          <Terminal size={13} color="#4294F7" />
          <span>Консоль</span>

          {waitingForInput && (
            <span className={styles.waitingBadge}>
              <Keyboard size={11} />
              <span>Ожидание ввода</span>
            </span>
          )}

          {!waitingForInput && hasScanner && (
            <span className={styles.scannerBadge} title="Код использует Scanner / System.in">
              <Keyboard size={11} />
              <span>Scanner активен</span>
            </span>
          )}
        </div>

        <div className={styles.headerRight}>
          {runStdin.trim() && (
            <div className={styles.stdinTagGroup} title={`Текущий буфер stdin:\n${runStdin}`}>
              <span className={styles.stdinTag}>
                stdin: {runStdin.replace(/\n/g, '↵ ').slice(0, 24)}
                {runStdin.length > 24 ? '...' : ''}
              </span>
              <button
                type="button"
                className={styles.resetStdinBtn}
                onClick={() => setRunStdin('')}
                title="Очистить буфер ввода (stdin)"
                aria-label="Очистить буфер ввода"
              >
                <RotateCcw size={11} />
              </button>
            </div>
          )}

          <button
            type="button"
            className={styles.clearBtn}
            onClick={clearConsole}
            title="Очистить консоль"
          >
            <Trash2 size={12} />
            <span>Очистить</span>
          </button>
        </div>
      </div>

      {/* Log list / console screen */}
      <div className={styles.logList} ref={listRef}>
        {consoleLogs.length === 0 ? (
          <div className={styles.emptyState}>
            Консоль готова к работе. Введите данные ниже в строку ввода или нажмите «Run».
          </div>
        ) : (
          consoleLogs.map((log) => {
            if (log.type === 'input') {
              return (
                <div key={log.id} className={`${styles.logEntry} ${styles.input}`}>
                  <span className={styles.timestamp}>[{log.timestamp}]</span>
                  <span className={styles.inputPrefix}>❯</span>
                  <span className={styles.inputMessage}>{log.message}</span>
                </div>
              );
            }
            if (log.type === 'prompt') {
              return (
                <div key={log.id} className={`${styles.logEntry} ${styles.prompt}`}>
                  <span className={styles.timestamp}>[{log.timestamp}]</span>
                  <span className={styles.promptMessage}>{log.message}</span>
                </div>
              );
            }
            return (
              <div key={log.id} className={`${styles.logEntry} ${styles[log.type]}`}>
                <span className={styles.timestamp}>[{log.timestamp}]</span>
                <span className={styles.message}>{log.message}</span>
              </div>
            );
          })
        )}

        {waitingForInput && (
          <div className={styles.activeWaitingLine}>
            <span className={styles.promptPrefix}>❯</span>
            <span className={styles.activeWaitingText}>
              Программа ожидает ввод данных. Введите значение ниже и нажмите Enter...
            </span>
            <span className={styles.blinkingCursor}>█</span>
          </div>
        )}
      </div>

      {/* Interactive Input Bar */}
      <form
        className={`${styles.inputBar} ${waitingForInput ? styles.waitingActive : ''}`}
        onSubmit={handleSubmit}
      >
        <span className={styles.inputSymbol} title="Строка ввода в System.in">
          ❯
        </span>

        {isMultiline ? (
          <textarea
            ref={textareaRef}
            id="console-stdin-input"
            aria-label="Ввод в консоль"
            className={styles.consoleTextarea}
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isRunning || isCompiling}
            rows={2}
            placeholder={
              waitingForInput
                ? 'Введите строки для Scanner (Ctrl+Enter для отправки)...'
                : 'Многострочный ввод для System.in (Ctrl+Enter для отправки)...'
            }
          />
        ) : (
          <input
            ref={inputRef}
            type="text"
            id="console-stdin-input"
            aria-label="Ввод в консоль"
            className={styles.consoleInput}
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isRunning || isCompiling}
            autoComplete="off"
            placeholder={
              waitingForInput
                ? 'Введите значение для Scanner и нажмите Enter...'
                : hasScanner
                ? 'Введите данные для System.in / Scanner (Enter для отправки)...'
                : 'Ввод в консоль (Enter для запуска с входными данными)...'
            }
          />
        )}

        {inputVal.length > 0 && (
          <button
            type="button"
            className={styles.clearInputBtn}
            onClick={() => {
              setInputVal('');
              if (isMultiline) textareaRef.current?.focus();
              else inputRef.current?.focus();
            }}
            title="Очистить строку ввода"
            aria-label="Очистить строку ввода"
          >
            <X size={12} />
          </button>
        )}

        <button
          type="button"
          className={`${styles.multilineBtn} ${isMultiline ? styles.active : ''}`}
          onClick={() => setIsMultiline(!isMultiline)}
          title={isMultiline ? 'Однострочный ввод' : 'Многострочный ввод'}
          aria-label="Переключить режим многострочного ввода"
        >
          <SlidersHorizontal size={12} />
        </button>

        <button
          type="submit"
          id="console-send-btn"
          className={styles.sendBtn}
          disabled={isRunning || isCompiling || (inputVal.length === 0 && !waitingForInput)}
          title={isMultiline ? 'Отправить (Ctrl+Enter)' : 'Отправить (Enter)'}
        >
          <CornerDownLeft size={13} />
          <span>{waitingForInput ? 'Ввести' : 'Отправить'}</span>
        </button>
      </form>
    </div>
  );
};
