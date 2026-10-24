import { Sparkles, X } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import styles from './OptimizationModal.module.scss';
export const OptimizationModal = () => {
  const show = useProjectStore(s => s.showOptimizationModal);
  const close = useProjectStore(s => s.setShowOptimizationModal);
  const recommendations = useProjectStore(s => s.recommendations);
  if (!show) return null;
  return <div className={styles.modalOverlay} onClick={() => close(false)}>
    <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
      <div className={styles.modalHeader}>
        <div className={styles.headerLeft}><Sparkles size={16} /><span>Рекомендации по текущему коду</span></div>
        <button className={styles.closeBtn} onClick={() => close(false)} aria-label="Закрыть"><X size={16} /></button>
      </div>
      <div className={styles.modalBody}>
        <p>Автоматические AI-предложения пока не подключены. Измените блок или Java-код и запустите проверку поведения.</p>
        {recommendations.length ? recommendations.map(r => <div key={r.id} className={styles.impItem}><strong>{r.title}</strong><p>{r.description}</p></div>) : <p>Статический анализ не нашёл поддерживаемых проблем.</p>}
      </div>
      <div className={styles.modalFooter}><button className={styles.cancelBtn} onClick={() => close(false)}>Закрыть</button></div>
    </div>
  </div>;
};
