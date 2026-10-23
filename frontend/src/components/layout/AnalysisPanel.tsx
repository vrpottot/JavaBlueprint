import {
  AlertCircle,
  Lightbulb,
  ExternalLink,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  ChevronDown,
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
    <aside className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <span>Analysis</span>
        <span className={styles.headerBadge}>{activeIssuesCount} issues</span>
      </div>

      {/* Tabs matching screenshot: Code Insights, Rekomending, Metrics */}
      <div className={styles.tabs}>
        <div
          className={`${styles.tab} ${activeTab === 'issues' ? styles.active : ''}`}
          onClick={() => setActiveTab('issues')}
        >
          Code Insights
        </div>
        <div
          className={`${styles.tab} ${activeTab === 'recommendations' ? styles.active : ''}`}
          onClick={() => setActiveTab('recommendations')}
        >
          Rekomending ({recommendations.length})
        </div>
        <div
          className={`${styles.tab} ${activeTab === 'metrics' ? styles.active : ''}`}
          onClick={() => setActiveTab('metrics')}
        >
          Metrics
        </div>
      </div>

      {/* Tab Content */}
      <div className={styles.content}>
        {activeTab === 'issues' && (
          <>
            {issues.map((issue) => (
              <div
                key={issue.id}
                className={`${styles.issueCard} ${issue.resolved ? styles.resolved : ''}`}
              >
                <div className={styles.cardTop}>
                  <div className={styles.titleArea}>
                    <AlertCircle
                      size={15}
                      color={issue.level === 'high' ? '#DC2626' : '#EA580C'}
                      fill={issue.level === 'high' ? '#FEE2E2' : '#FFEDD5'}
                    />
                    <span className={styles.cardTitle}>{issue.title}</span>
                  </div>

                  <div className={styles.badgeGroup}>
                    <span
                      className={`${styles.severityBadge} ${
                        issue.level === 'high'
                          ? styles.high
                          : issue.level === 'medium'
                          ? styles.medium
                          : styles.low
                      }`}
                    >
                      {issue.level === 'high' ? 'High' : issue.level === 'medium' ? 'Medium' : 'Low'}
                    </span>
                    <span className={styles.cardFile}>{issue.file}</span>
                  </div>
                </div>

                <p className={styles.cardDesc}>{issue.description}</p>

                {issue.nodeId && (
                  <button
                    className={styles.jumpBtn}
                    onClick={() => issue.nodeId && focusNodeFromIssue(issue.nodeId)}
                  >
                    <ExternalLink size={11} />
                    <span>Перейти к блоку</span>
                  </button>
                )}
              </div>
            ))}
          </>
        )}

        {activeTab === 'recommendations' && (
          <>
            {recommendations.map((rec) => (
              <div key={rec.id} className={styles.issueCard}>
                <div className={styles.cardTop}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Lightbulb size={13} color="var(--accent-orange)" />
                    <span className={styles.cardTitle}>{rec.title}</span>
                  </div>
                  <span className={`${styles.severityBadge} ${styles.low}`}>{rec.tag}</span>
                </div>

                <p className={styles.cardDesc}>{rec.description}</p>
              </div>
            ))}
          </>
        )}

        {activeTab === 'metrics' && (
          <div className={styles.metricsGrid}>
            <div className={styles.metricCard}>
              <span className={styles.metricValue}>{metrics.cyclomaticComplexity}</span>
              <span className={styles.metricLabel}>Цикломатическая сложность</span>
            </div>

            <div className={styles.metricCard}>
              <span className={styles.metricValue}>{metrics.linesOfCode}</span>
              <span className={styles.metricLabel}>Строк кода (LOC)</span>
            </div>

            <div className={styles.metricCard}>
              <span className={styles.metricValue}>{metrics.nestingDepth}</span>
              <span className={styles.metricLabel}>Глубина вложенности</span>
            </div>

            <div className={styles.metricCard}>
              <span className={styles.metricValue} style={{ color: 'var(--accent-green)' }}>
                {metrics.testCoverage}%
              </span>
              <span className={styles.metricLabel}>Покрытие тестами</span>
            </div>
          </div>
        )}
      </div>

      {/* Complexity & Optimization Section from reference photo */}
      <div className={styles.complexitySection}>
        <div className={styles.complexityHeader}>
          <ChevronDown size={14} />
          <span>Complexity</span>
        </div>

        <div className={styles.complexityComparison}>
          <span>Current:</span>
          <span className={styles.compRed}>{complexity.current}</span>
          <ArrowRight size={13} className={styles.arrow} />
          <span>Optimized:</span>
          <span className={styles.compGreen}>{complexity.optimized}</span>
        </div>

        {/* Green Performance Estimation Card */}
        <div className={styles.perfEstimationCard}>
          <div className={styles.perfTop}>
            <CheckCircle2 size={13} color="#059669" />
            <span>Performance Estimation</span>
          </div>
          <div className={styles.perfMain}>
            <span>Expected acceleration:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
              <span className={styles.highlight}>{complexity.speedup}</span>
              <ArrowUpRight size={15} color="#059669" />
            </div>
          </div>
        </div>

        <p className={styles.explanation}>{complexity.explanation}</p>

        {!isOptimized ? (
          <button className={styles.applyBtn} onClick={applyOptimization}>
            <Sparkles size={13} />
            <span>Применить оптимизацию</span>
          </button>
        ) : (
          <button className={`${styles.applyBtn} ${styles.applied}`} disabled>
            <CheckCircle2 size={13} />
            <span>Оптимизация активна</span>
          </button>
        )}
      </div>
    </aside>
  );
};
