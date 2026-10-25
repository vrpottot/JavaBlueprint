import type { BlockPaletteItem } from '../types';
export const PALETTE_ITEMS: BlockPaletteItem[] = [
  { type: 'variable', name: 'Переменная', description: 'Объявление локальной переменной', defaultCode: 'int value = 0;', color: 'var(--node-variable, #A855F7)' },
  { type: 'condition', name: 'Условие', description: 'Ветвление if/else', defaultCode: 'if (true) { }', color: 'var(--node-condition, #F59E0B)' },
  { type: 'loop', name: 'Цикл', description: 'Цикл for', defaultCode: 'for (int i = 0; i < 10; i++) { }', color: 'var(--node-loop, #10B981)' },
  { type: 'method', name: 'Метод', description: 'Добавить метод в выбранный класс', defaultCode: '', color: 'var(--node-method, #0EA5E9)' },
  { type: 'operation', name: 'Операция', description: 'Вызов или выражение', defaultCode: 'System.out.println("Hello");', color: 'var(--node-operation, #84CC16)' },
  { type: 'return', name: 'Возврат', description: 'Возврат из void-метода; для других типов отредактируйте выражение', defaultCode: 'return;', color: 'var(--node-return, #F43F5E)' },
];
