import { Sparkles, X, ArrowRight, Zap, CheckCircle2 } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import styles from './OptimizationModal.module.scss';

export const OptimizationModal: React.FC = () => {
  const showOptimizationModal = useProjectStore((s) => s.showOptimizationModal);
  const setShowOptimizationModal = useProjectStore((s) => s.setShowOptimizationModal);
  const applyOptimization = useProjectStore((s) => s.applyOptimization);

  if (!showOptimizationModal) return null;

  const originalSnippet = `public List<Order> processOrders(List<Order> orders) {
    List<Order> result = new ArrayList<>();
    if (orders == null || orders.isEmpty()) return result;

    for (Order order : orders) {
        if (validator.isValidOrder(order)) {
            Order processed = processOrder(order);
            result.add(processed);
        } else {
            continue;
        }
    }
    return result;
}`;

  const optimizedSnippet = `public List<Order> processOrders(List<Order> orders) {
    if (orders == null || orders.isEmpty()) {
        return List.of();
    }

    return orders.parallelStream()
        .filter(Objects::nonNull)
        .filter(validator::isValidOrder)
        .map(this::processOrder)
        .collect(Collectors.toList());
}`;

  return (
    <div className={styles.modalOverlay} onClick={() => setShowOptimizationModal(false)}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.headerLeft}>
            <Sparkles size={16} color="#F4A34B" />
            <span>Предложение оптимизации: processOrders()</span>
          </div>
          <button
            className={styles.closeBtn}
            onClick={() => setShowOptimizationModal(false)}
            title="Закрыть"
          >
            <X size={16} />
          </button>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.statsBanner}>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Снижение Big O</span>
              <span className={styles.statVal} style={{ color: '#F4A34B' }}>
                O(n²) <ArrowRight size={13} style={{ display: 'inline' }} /> O(n log n)
              </span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Ожидаемое ускорение</span>
              <span className={styles.statVal} style={{ color: '#39C98A' }}>
                до 5.2x
              </span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Сокращение строк</span>
              <span className={styles.statVal} style={{ color: '#4294F7' }}>
                42 → 24 LOC (-43%)
              </span>
            </div>
          </div>

          <div className={styles.comparisonView}>
            <div className={styles.codeBox}>
              <div className={styles.codeBoxHeader}>
                <span>Исходная версия</span>
                <span style={{ color: '#F16C70' }}>O(n²)</span>
              </div>
              <pre className={styles.codeContent}>{originalSnippet}</pre>
            </div>

            <div className={styles.codeBox}>
              <div className={styles.codeBoxHeader}>
                <span style={{ color: '#39C98A' }}>Оптимизированная версия</span>
                <span style={{ color: '#39C98A' }}>O(n log n)</span>
              </div>
              <pre className={styles.codeContent}>{optimizedSnippet}</pre>
            </div>
          </div>

          <div className={styles.improvementsList}>
            <div className={styles.impItem}>
              <CheckCircle2 size={14} color="#39C98A" />
              <span>Замена for-each на параллельный pipeline `parallelStream()`</span>
            </div>
            <div className={styles.impItem}>
              <CheckCircle2 size={14} color="#39C98A" />
              <span>Устранение аллокаций: возврат иммутабельного `List.of()`</span>
            </div>
            <div className={styles.impItem}>
              <CheckCircle2 size={14} color="#39C98A" />
              <span>Устранение дублирующей валидации и исключение скрытых циклов</span>
            </div>
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button className={styles.cancelBtn} onClick={() => setShowOptimizationModal(false)}>
            Отмена
          </button>
          <button className={styles.applyBtn} onClick={applyOptimization}>
            <Zap size={14} />
            <span>Применить оптимизацию к коду и графу</span>
          </button>
        </div>
      </div>
    </div>
  );
};
