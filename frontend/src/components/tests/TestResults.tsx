import React, { useRef } from 'react';
import {
  CheckCircle2,
  RotateCw,
  Clock,
  AlertCircle,
  Loader2,
  FlaskConical,
  FilePlus,
  Sparkles,
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import type { TestCase } from '../../types';
import styles from './TestResults.module.scss';

export const TestResults: React.FC = () => {
  const testCases = useProjectStore((s) => s.testCases);
  const runProgram = useProjectStore((s) => s.runProgram);
  const isRunning = useProjectStore((s) => s.isRunning);
  const isCompiling = useProjectStore((s) => s.isCompiling);
  const importJavaFiles = useProjectStore((s) => s.importJavaFiles);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isBusy = isRunning || isCompiling;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploaded = Array.from(e.target.files || []);
    if (!uploaded.length) return;
    try {
      const parsedFiles = await Promise.all(
        uploaded.map(async (f) => ({ path: f.name, content: await f.text() }))
      );
      await importJavaFiles(parsedFiles, false);
      await runProgram();
    } catch (err) {
      console.error('Ошибка добавления файла тестов:', err);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleAddSampleTest = async () => {
    const sampleCode = `import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

public class AppTest {
    @Test
    void testExecution() {
        assertTrue(true, "Пример успешного выполнения теста");
    }
}
`;
    await importJavaFiles([{ path: 'AppTest.java', content: sampleCode }], false);
    await runProgram();
  };

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
      <input
        type="file"
        ref={fileInputRef}
        accept=".java"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileUpload}
      />

      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <FlaskConical size={14} className={testCases.length > 0 ? styles.iconSuccess : styles.iconPending} />
          <span>Результаты тестов</span>
        </div>

        <div className={styles.headerActions}>
          <button
            className={styles.addTestBtn}
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy}
            title="Добавить тестовый файл в проект"
          >
            <FilePlus size={12} />
            <span>Добавить тесты</span>
          </button>

          <button
            className={styles.rerunBtn}
            onClick={() => void runProgram()}
            disabled={isBusy}
            title="Запустить повторный прогон тестов"
          >
            <RotateCw size={12} className={isBusy ? styles.spin : ''} />
            <span>{isBusy ? 'Выполняются...' : 'Перезапустить'}</span>
          </button>
        </div>
      </div>

      {testCases.length > 0 ? (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>

            <tbody>
              {testCases.map((tc) => (
                <tr key={tc.id} className={styles.tableRow} title={tc.details}>
                  <td>
                    <div className={styles.testNameCell}>
                      {renderStatusIcon(tc)}
                      <span className={styles.testNameText}>{tc.name}</span>
                    </div>
                    {tc.details && tc.status === 'failure' && (
                      <div className={styles.failureDetails}>
                        {tc.details}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* Empty State: Описание того, как запустить тесты */
        <div className={styles.emptyStateContainer}>
          <div className={styles.emptyStateIconWrap}>
            <FlaskConical size={28} className={styles.emptyIcon} />
          </div>

          <h3 className={styles.emptyTitle}>Тесты не обнаружены</h3>

          <p className={styles.emptyDescription}>
            Чтобы запустить тестирование программы с помощью тестов, добавьте файл тестов в общий список файлов проекта.
          </p>

          <div className={styles.guideCard}>
            <div className={styles.guideTitle}>Как запустить тестирование:</div>
            <ol className={styles.guideSteps}>
              <li>
                Добавьте файл с тестами (например, <code>MainTest.java</code> с аннотациями <code>@Test</code>) через панель «Файлы проекта» слева или по кнопке ниже.
              </li>
              <li>
                Нажмите <strong>«Run»</strong> или <strong>«Перезапустить»</strong> — система автоматически обнаружит JUnit-тесты, скомпилирует и запустит их в изолированном окружении.
              </li>
            </ol>
          </div>

          <div className={styles.emptyActions}>
            <button
              className={styles.primaryActionBtn}
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
            >
              <FilePlus size={14} />
              <span>Загрузить .java файл тестов</span>
            </button>

            <button
              className={styles.secondaryActionBtn}
              onClick={handleAddSampleTest}
              disabled={isBusy}
              title="Создать готовый пример JUnit 5 теста"
            >
              <Sparkles size={14} />
              <span>Создать пример теста (AppTest.java)</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
