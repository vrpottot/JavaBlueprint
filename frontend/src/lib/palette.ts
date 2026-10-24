import type { BlockPaletteItem } from '../types';
export const PALETTE_ITEMS: BlockPaletteItem[] = [
  { type: 'variable', name: 'Переменная', description: 'Объявление локальной переменной', defaultCode: 'int value = 0;', color: '#4294F7' },
  { type: 'condition', name: 'Условие', description: 'Ветвление if/else', defaultCode: 'if (true) { }', color: '#F4A34B' },
  { type: 'loop', name: 'Цикл', description: 'Цикл for', defaultCode: 'for (int i = 0; i < 10; i++) { }', color: '#A879F8' },
  { type: 'method', name: 'Метод', description: 'Добавить метод в выбранный класс', defaultCode: '', color: '#A879F8' },
  { type: 'operation', name: 'Операция', description: 'Вызов или выражение', defaultCode: 'System.out.println("Hello");', color: '#388BFD' },
  { type: 'return', name: 'Возврат', description: 'Возврат из void-метода; для других типов отредактируйте выражение', defaultCode: 'return;', color: '#39C98A' },
];
