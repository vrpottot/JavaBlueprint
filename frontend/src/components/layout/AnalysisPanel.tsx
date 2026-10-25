import { useState } from 'react';
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
  Bot,
  MessageSquare,
} from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import { AIChat } from '../chat/AIChat';
import styles from './AnalysisPanel.module.scss';

export const AnalysisPanel: React.FC = () => {
  const [panelMode, setPanelMode] = useState<'chat' | 'summary'>('chat');
  const issues = useProjectStore((s) => s.issues);
  const recommendations = useProjectStore((s) => s.recommendations);
  const metrics = useProjectStore((s) => s.metrics);
  const complexity = useProjectStore((s) => s.complexity);
  const methodComplexities = useProjectStore((s) => s.methodComplexities);
  const isOptimized = useProjectStore((s) => s.isOptimized);
  const activeTab = useProjectStore((s) => s.activeAnalysisTab);
  const setActiveTab = useProjectStore((s) => s.setActiveAnalysisTab);
  const focusNodeFromIssue = useProjectStore((s) => s.focusNodeFromIssue);
  const applyOptimization = useProjectStore((s) => s.applyOptimization);

  const activeIssuesCount = issues.filter((i) => !i.resolved).length;

  return (
    <aside className={styles.panel} aria-label="Code Analysis Panel">
      {/* Header with Mode Switcher */}
      <div className={styles.header}>
        <div className={styles.modeSwitcher} role="group" aria-label="Режим панели">
          <button
            className={`${styles.modeBtn} ${panelMode === 'chat' ? styles.active : ''}`}
            onClick={() => setPanelMode('chat')}
            title="Интеллектуальный ИИ-чат для анализа и оптимизации"
          >
            <Bot size={13} />
            <span>Чат с ИИ</span>
          </button>
          <button
            className={`${styles.modeBtn} ${panelMode === 'summary' ? styles.active : ''}`}
            onClick={() => setPanelMode('summary')}
            title="Классическая сводка метрик и проблем"
          >
            <BarChart2 size={13} />
            <span>Сводка</span>
          </button>
        </div>

        <span className={styles.headerBadge}>
          {activeIssuesCount} {activeIssuesCount === 1 ? 'проблема' : 'проблем'}
        </span>
      </div>

      <div style={{ display: panelMode === 'chat' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
        <AIChat />
      </div>

      <div style={{ display: panelMode === 'summary' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
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
          issues.length === 0 ? (
            <div className={styles.emptyTabState}>
              <CheckCircle2 size={32} className={styles.emptyIconSuccess} />
              <div className={styles.emptyTitle}>Проблем не обнаружено</div>
              <div className={styles.emptySubtitle}>
                Статический анализ не выявил критических дефектов. Попросите ИИ сделать глубокую сводку в чате.
              </div>
              <button
                className={styles.emptyActionBtn}
                onClick={() => setPanelMode('chat')}
              >
                <Bot size={13} />
                <span>Запросить сводку у ИИ</span>
              </button>
            </div>
          ) : (
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
          )
        )}

        {activeTab === 'recommendations' && (
          recommendations.length === 0 ? (
            <div className={styles.emptyTabState}>
              <Lightbulb size={32} className={styles.emptyIconTip} />
              <div className={styles.emptyTitle}>Рекомендаций пока нет</div>
              <div className={styles.emptySubtitle}>
                ИИ-ассистент готов сформировать рекомендации по оптимизации алгоритмов, Big O и улучшению чистоты кода.
              </div>
              <button
                className={styles.emptyActionBtn}
                onClick={() => setPanelMode('chat')}
              >
                <Bot size={13} />
                <span>Запросить рекомендации</span>
              </button>
            </div>
          ) : (
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
          )
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
              <span className={styles.metricSub}>Во всём проекте</span>
            </div>

            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Глубина вложенности</span>
              <span className={`${styles.metricValue} ${styles.valAlert}`}>
                {metrics.nestingDepth}
              </span>
              <span className={styles.metricSub}>По структуре AST</span>
            </div>

            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Покрытие тестами</span>
              <span className={`${styles.metricValue} ${styles.valSuccess}`}>
                {metrics.testCoverage === null ? 'Не измерено' : `${metrics.testCoverage}%`}
              </span>
              <span className={styles.metricSub}>Запуск JUnit не измеряет покрытие</span>
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
        <p className={styles.explanation}>
          Оценено: {methodComplexities.filter(method => method.estimate !== 'unknown').length} из {methodComplexities.length}. Верхние границы зависят от указанных предположений.
        </p>
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          {(methodComplexities || []).map((method) => (
            <details key={method.methodId} style={{ marginBottom: 10 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12 }}>
                {method.method}: <strong>{method.estimate === 'unknown' ? 'Неизвестно' : method.estimate.length > 100 ? 'Составная оценка — раскрыть' : method.estimate}</strong>
              </summary>
              {method.estimate.length > 100 && <pre className={styles.costFormula}>{method.estimate}</pre>}
              {method.explanation && <p className={styles.explanation}>{method.explanation}</p>}
              {method.file && <p className={styles.explanation}>{method.file}:{method.line}</p>}
              {(method.assumptions || []).map((a, i) => (
                <p className={styles.explanation} key={`a${i}`}>{a}</p>
              ))}
              {(method.evidence || []).map((e, i) => (
                <p className={styles.explanation} key={`e${i}`}>L{e.line}: {e.estimate} — {e.rule}</p>
              ))}
              <button className={styles.jumpBtn} onClick={() => focusNodeFromIssue(method.methodId)}>
                К методу
              </button>
            </details>
          ))}
        </div>

        {!isOptimized ? (
          <button className={styles.applyBtn} onClick={applyOptimization}>
            <Sparkles size={14} />
            <span>Рекомендации</span>
          </button>
        ) : (
          <button className={`${styles.applyBtn} ${styles.applied}`} disabled>
            <CheckCircle2 size={14} />
            <span>Код изменён</span>
          </button>
        )}

        <button
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '7px 12px',
            borderRadius: '6px',
            border: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-panel)',
            color: 'var(--text-primary)',
            fontSize: '11.5px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
          onClick={() => setPanelMode('chat')}
          title="Перейти к интерактивному общению с ИИ"
        >
          <MessageSquare size={13} color="var(--accent-blue)" />
          <span>Открыть ИИ-чат для оптимизации...</span>
        </button>
      </div>
    </div>
  </aside>
  );
};
