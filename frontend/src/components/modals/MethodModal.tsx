import { useEffect, useRef, useState } from 'react';
import { Check, Code2, Loader2, X } from 'lucide-react';
import { useProjectStore } from '../../store/useProjectStore';
import styles from './MethodModal.module.scss';

export function MethodModal() {
  const dialog = useProjectStore(s => s.methodDialog);
  if (!dialog) return null;
  return <MethodForm key={`${dialog.mode}:${dialog.nodeId || dialog.containerId}:${dialog.revision}`} dialog={dialog} />;
}

type Dialog = NonNullable<ReturnType<typeof useProjectStore.getState>['methodDialog']>;
function MethodForm({ dialog }: { dialog: Dialog }) {
  const containers = useProjectStore(s => s.containers);
  const isLoading = useProjectStore(s => s.isLoading);
  const close = useProjectStore(s => s.closeMethodDialog);
  const save = useProjectStore(s => s.saveMethod);
  const preview = useProjectStore(s => s.previewMethod);
  const [containerId, setContainerId] = useState(dialog.containerId);
  const initialOwner = containers.find(c => c.id === dialog.containerId);
  let nextName = 'newMethod', suffix = 2;
  while (initialOwner?.methodNames.includes(nextName)) nextName = `newMethod${suffix++}`;
  const [signature, setSignature] = useState(dialog.initial?.signature || `public static int ${nextName}(int value)`);
  const [body, setBody] = useState(dialog.initial?.body ?? 'return value * 2;');
  const [hasBody, setHasBody] = useState(dialog.initial?.hasBody ?? true);
  const [pending, setPending] = useState<'save' | 'preview' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validated, setValidated] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const errorElement = useRef<HTMLParagraphElement>(null);
  const lock = useRef(false);
  const owner = containers.find(c => c.id === containerId);
  const code = hasBody ? `${signature.trim()} {\n${body}\n}` : `${signature.trim().replace(/;\s*$/, '')};`;
  const validationKey = `${containerId}:${code}`;
  const disabled = pending !== null || isLoading;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    form.current?.querySelector<HTMLTextAreaElement>('#method-signature')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { if (error) errorElement.current?.focus(); }, [error]);
  useEffect(() => {
    if (disabled) form.current?.focus();
    else if (document.activeElement === form.current) form.current?.querySelector<HTMLTextAreaElement>('#method-signature')?.focus();
  }, [disabled]);

  async function perform(action: 'save' | 'preview') {
    if (lock.current || isLoading) return;
    lock.current = true; setPending(action); setError(null);
    try {
      if (!owner?.canAddMethods) throw new Error('Выберите класс или интерфейс для метода.');
      if (action === 'preview') {
        await preview(containerId, code); setValidated(validationKey);
      } else await save(containerId, code);
    } catch (failure) {
      setValidated('');
      setError(failure instanceof Error ? failure.message : 'Не удалось сохранить метод.');
    } finally { lock.current = false; setPending(null); }
  }

  return <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="method-dialog-title" aria-describedby="method-dialog-hint">
    <form ref={form} tabIndex={-1} aria-busy={disabled} className={styles.form} onSubmit={e => { e.preventDefault(); void perform('save'); }} onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!disabled) close(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); form.current?.requestSubmit(); }
      if (e.key === 'Tab') {
        const controls = Array.from(form.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)') || []).filter(n => n.tabIndex >= 0);
        const first = controls[0], last = controls[controls.length - 1];
        if (!controls.length) e.preventDefault();
        else if (e.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement as HTMLElement))) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <div className={styles.header}>
        <div><Code2 size={18} /><h2 id="method-dialog-title">{dialog.mode === 'edit' ? 'Редактировать метод' : 'Добавить метод'}</h2></div>
        <button type="button" onClick={close} disabled={disabled} aria-label="Закрыть редактор метода"><X size={18} /></button>
      </div>
      <div className={styles.content}>
        <p id="method-dialog-hint" className={styles.hint}>Метод появится в выбранном классе, Java-коде и на схеме.</p>
        <label className={styles.field}>
          <span>Класс и файл</span>
          <select aria-label="Класс и файл" value={containerId} disabled={disabled || dialog.mode === 'edit'} onChange={e => { setContainerId(e.target.value); setError(null); }}>
            {containers.map(c => <option key={c.id} value={c.id} disabled={!c.canAddMethods}>{c.name} — {c.file} ({c.kind})</option>)}
          </select>
        </label>
        <label className={styles.field} htmlFor="method-signature">
          <span id="method-signature-label">Сигнатура метода</span>
          <textarea id="method-signature" aria-labelledby="method-signature-label" aria-describedby="method-signature-hint" rows={2} value={signature} onChange={e => { setSignature(e.target.value); setError(null); }} disabled={disabled} required spellCheck={false} autoCapitalize="off" autoCorrect="off" placeholder="public static int calculate(int value)" />
          <small id="method-signature-hint">Доступ, тип результата, имя и параметры. Можно указать дженерики и throws.</small>
        </label>
        <label className={styles.checkbox}>
          <input type="checkbox" checked={!hasBody} disabled={disabled} onChange={e => { setHasBody(!e.target.checked); setError(null); }} />
          <span>Только объявление, без тела — для интерфейса или abstract/native-метода</span>
        </label>
        {hasBody && <label className={styles.field} htmlFor="method-body">
          <span id="method-body-label">Тело метода</span>
          <textarea id="method-body" aria-labelledby="method-body-label" aria-describedby="method-body-hint" rows={9} value={body} onChange={e => { setBody(e.target.value); setError(null); }} disabled={disabled} spellCheck={false} autoCapitalize="off" autoCorrect="off" placeholder="return value * 2;" />
          <small id="method-body-hint">Внешние фигурные скобки добавятся автоматически.</small>
        </label>}
        <div className={styles.feedback}>
          {error && <p ref={errorElement} role="alert" tabIndex={-1} className={styles.error}>{error}</p>}
          {!error && validated === validationKey && <p role="status" className={styles.success}><Check size={15} />Синтаксис корректен. Компиляцию и тесты можно запустить после сохранения.</p>}
        </div>
      </div>
      <div className={styles.footer}>
        <span className={styles.shortcut}>Ctrl / ⌘ + Enter — сохранить</span>
        <button type="button" onClick={close} disabled={disabled}>Отмена</button>
        <button type="button" disabled={disabled || !signature.trim()} onClick={() => void perform('preview')}>{pending === 'preview' && <Loader2 size={14} className={styles.spin} />}Проверить синтаксис</button>
        <button type="submit" className={styles.primary} disabled={disabled || !signature.trim()}>{pending === 'save' && <Loader2 size={14} className={styles.spin} />}{dialog.mode === 'edit' ? 'Сохранить метод' : 'Добавить метод'}</button>
      </div>
    </form>
  </div>;
}
