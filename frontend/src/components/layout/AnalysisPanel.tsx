import {
  Lightbulb,
  ExternalLink,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  TrendingUp,
  BarChart2,
  ShieldAlert,
  ArrowUpRight,
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import styles from './AnalysisPanel.module.scss';

export const AnalysisPanel: React.FC = () => {
  const issues = useProjectStore((s) => s.issues);
  const recommendations = useProjectStore((s) => s.recommendations);
  const metrics = useProjectStore((s) => s.metrics);
  const complexity = useProjectStore((s) => s.complexity);
  const isOptimized = useProjectStore((s) => s.isOptimized);
  const activeTab = useProjectStore((s) => s.activeAnalysisTab);
  const setActiveTab = useProjectStore((s) => s.setActiveAnalysisTab);
  const focusNodeFromIssue = useProjectStore((s) => s.focusNodeFromIssue);
  const applyOptimization = useProjectStore((s) => s.applyOptimization);

  const activeIssuesCount = issues.filter((i) => !i.resolved).length;

  return (
    <aside className={styles.panel} aria-label="Code Analysis Panel">
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <BarChart2 size={15} className={styles.headerIcon} />
          <span>Анализ кода</span>
        </div>
        <span className={styles.headerBadge}>
          {activeIssuesCount} {activeIssuesCount === 1 ? 'проблема' : 'проблем'}
        </span>
      </div>

      {/* Tabs */}
      <div className={styles.tabs} role="tablist">
        <button
          className={`${styles.tab} ${activeTab === 'issues' ? styles.active : ''}`}
          onClick={() => setActiveTab('issues')}
          role="tab"
          aria-selected={activeTab === 'issues'}
        >
          <span>Проблемы</span>
          {activeIssuesCount > 0 && <span className={styles.tabCounter}>{activeIssuesCount}</span>}
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'recommendations' ? styles.active : ''}`}
          onClick={() => setActiveTab('recommendations')}
          role="tab"
          aria-selected={activeTab === 'recommendations'}
        >
          <span>Рекомендации</span>
          <span className={styles.tabCounter}>{recommendations.length}</span>
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'metrics' ? styles.active : ''}`}
          onClick={() => setActiveTab('metrics')}
          role="tab"
          aria-selected={activeTab === 'metrics'}
        >
          <span>Метрики</span>
        </button>
      </div>

      {/* Tab Content */}
      <div className={styles.content}>
        {activeTab === 'issues' && (
          <div className={styles.cardsList}>
            {issues.map((issue) => (
              <div
                key={issue.id}
                className={`${styles.issueCard} ${issue.resolved ? styles.resolved : ''}`}
              >
                <div className={styles.cardTop}>
                  <div className={styles.titleArea}>
                    <ShieldAlert
                      size={15}
                      className={issue.level === 'high' ? styles.highIcon : styles.mediumIcon}
                    />
                    <span className={styles.cardTitle}>{issue.title}</span>
                  </div>

                  <span
                    className={`${styles.severityBadge} ${
                      issue.level === 'high'
                        ? styles.high
                        : issue.level === 'medium'
                        ? styles.medium
                        : styles.low
                    }`}
                  >
                    {issue.level === 'high' ? 'Критично' : issue.level === 'medium' ? 'Средне' : 'Инфо'}
                  </span>
                </div>

                <p className={styles.cardDesc}>{issue.description}</p>

                <div className={styles.cardFooter}>
                  <span className={styles.cardFile}>{issue.file}</span>

                  {issue.nodeId && (
                    <button
                      className={styles.jumpBtn}
                      onClick={() => issue.nodeId && focusNodeFromIssue(issue.nodeId)}
                      title="Сфокусировать блок на диаграмме"
                    >
                      <span>К блоку</span>
                      <ExternalLink size={11} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'recommendations' && (
          <div className={styles.cardsList}>
            {recommendations.map((rec) => (
              <div key={rec.id} className={styles.issueCard}>
                <div className={styles.cardTop}>
                  <div className={styles.titleArea}>
                    <Lightbulb size={14} className={styles.recIcon} />
                    <span className={styles.cardTitle}>{rec.title}</span>
                  </div>
                  <span className={`${styles.severityBadge} ${styles.low}`}>{rec.tag}</span>
                </div>

                <p className={styles.cardDesc}>{rec.description}</p>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'metrics' && (
          <div className={styles.metricsGrid}>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Цикломатическая сложность</span>
              <span className={`${styles.metricValue} ${styles.valWarning}`}>
                {metrics.cyclomaticComplexity}
              </span>
              <span className={styles.metricSub}>Рекомендуется &lt; 10</span>
            </div>

            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Строк кода (LOC)</span>
              <span className={styles.metricValue}>{metrics.linesOfCode}</span>
              <span className={styles.metricSub}>В текущем файле</span>
            </div>

            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Глубина вложенности</span>
              <span className={`${styles.metricValue} ${styles.valAlert}`}>
                {metrics.nestingDepth}
              </span>
              <span className={styles.metricSub}>Уровень 4: вложенный цикл</span>
            </div>

            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Покрытие тестами</span>
              <span className={`${styles.metricValue} ${styles.valSuccess}`}>
                {metrics.testCoverage}%
              </span>
              <span className={styles.metricSub}>12 из 14 сценариев</span>
            </div>
          </div>
        )}
      </div>

      {/* Complexity & Optimization Section */}
      <div className={styles.complexitySection}>
        <div className={styles.complexityHeader}>
          <TrendingUp size={14} className={styles.compHeaderIcon} />
          <span>Вычислительная сложность</span>
        </div>

        <div className={styles.complexityComparison}>
          <div className={styles.compBox}>
            <span className={styles.compLabel}>Текущая</span>
            <span className={styles.compRed}>{complexity.current}</span>
          </div>

          <ArrowRight size={14} className={styles.arrow} />

          <div className={styles.compBox}>
            <span className={styles.compLabel}>Оптимизированная</span>
            <span className={styles.compGreen}>{complexity.optimized}</span>
          </div>
        </div>

        {/* Performance Estimation Card */}
        <div className={styles.perfEstimationCard}>
          <div className={styles.perfTop}>
            <CheckCircle2 size={14} />
            <span>Оценка прироста производительности</span>
          </div>
          <div className={styles.perfMain}>
            <span className={styles.perfSubText}>Ускорение обработки:</span>
            <div className={styles.speedupPill}>
              <span className={styles.highlight}>{complexity.speedup}</span>
              <ArrowUpRight size={14} />
            </div>
          </div>
        </div>

        <p className={styles.explanation}>{complexity.explanation}</p>

        {!isOptimized ? (
          <button className={styles.applyBtn} onClick={applyOptimization}>
            <Sparkles size={14} />
            <span>Применить оптимизацию</span>
          </button>
        ) : (
          <button className={`${styles.applyBtn} ${styles.applied}`} disabled>
            <CheckCircle2 size={14} />
            <span>Оптимизация активна</span>
          </button>
        )}
      </div>
    </aside>
  );
};
