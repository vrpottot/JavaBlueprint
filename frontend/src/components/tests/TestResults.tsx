import React from 'react';
import { CheckCircle2, RotateCw, Clock, AlertCircle, Loader2 } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import type { TestCase } from '../../types';
import styles from './TestResults.module.scss';

export const TestResults: React.FC = () => {
  const testCases = useProjectStore((s) => s.testCases);
  const runProgram = useProjectStore((s) => s.runProgram);
  const isRunning = useProjectStore((s) => s.isRunning);
  const isCompiling = useProjectStore((s) => s.isCompiling);

  const passedCount = testCases.filter((t) => t.status === 'success').length;
  const isAllPassed = passedCount === testCases.length && testCases.length > 0;
  const isBusy = isRunning || isCompiling;

  const renderStatusIcon = (tc: TestCase) => {
    switch (tc.status) {
      case 'success':
        return <CheckCircle2 size={13} className={styles.iconSuccess} />;
      case 'running':
        return <Loader2 size={13} className={styles.iconRunning} />;
      case 'failure':
        return <AlertCircle size={13} className={styles.iconFailure} />;
      default:
        return <Clock size={13} className={styles.iconPending} />;
    }
  };

  return (
    <div className={styles.testsContainer}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <CheckCircle2 size={14} className={styles.iconSuccess} />
          <span>Результаты тестов</span>
        </div>

        <button
          className={styles.rerunBtn}
          onClick={runProgram}
          disabled={isBusy}
          title="Запустить повторный прогон тестов"
        >
          <RotateCw size={12} className={isBusy ? styles.spin : ''} />
          <span>{isBusy ? 'Выполняются...' : 'Перезапустить'}</span>
        </button>
      </div>

      <div className={styles.summaryCard}>
        <div className={styles.summaryRow}>
          <div className={`${styles.summaryLeft} ${isBusy ? styles.running : ''}`}>
            {isBusy ? (
              <>
                <Loader2 size={15} className={styles.spin} />
                <span>Выполнение тестов...</span>
              </>
            ) : isAllPassed ? (
              <>
                <CheckCircle2 size={15} className={styles.iconSuccess} />
                <span>Все тесты пройдены</span>
              </>
            ) : (
              <span>Тесты завершены</span>
            )}
          </div>

          <span className={styles.summaryRight}>
            {passedCount} из {testCases.length}
          </span>
        </div>

        <div className={styles.progressBarTrack}>
          <div
            className={`${styles.progressBarFill} ${isBusy ? styles.running : ''}`}
            style={{ width: isBusy ? '60%' : `${(passedCount / Math.max(testCases.length, 1)) * 100}%` }}
          />
        </div>
      </div>

      {/* Test Table */}
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead className={styles.tableHead}>
            <tr>
              <th>Тест</th>
              <th>Результат</th>
              <th style={{ textAlign: 'right' }}>Время</th>
            </tr>
          </thead>
          <tbody>
            {testCases.map((tc) => (
              <tr key={tc.id} className={styles.tableRow} title={tc.details}>
                <td>
                  <div className={styles.testNameCell}>
                    {renderStatusIcon(tc)}
                    <span>{tc.name}</span>
                  </div>
                </td>
                <td>
                  <span
                    className={
                      tc.status === 'success'
                        ? styles.statusSuccess
                        : tc.status === 'running'
                        ? styles.statusRunning
                        : tc.status === 'failure'
                        ? styles.statusFailure
                        : styles.statusPending
                    }
                  >
                    {tc.status === 'success'
                      ? 'Успешно'
                      : tc.status === 'running'
                      ? 'Выполняется'
                      : tc.status === 'failure'
                      ? 'Ошибка'
                      : 'Ожидание'}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <span className={styles.durationCell}>
                    {tc.status === 'running'
                      ? '...'
                      : tc.status === 'success'
                      ? `${tc.durationMs} мс`
                      : '—'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
