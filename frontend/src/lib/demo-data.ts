import type { Node, Edge } from '@xyflow/react';
import type {
  FileItem,
  CodeIssue,
  CodeRecommendation,
  CodeMetrics,
  ComplexityEstimate,
  ConsoleLog,
  TestCase,
  BlockPaletteItem,
  VisualBlockData,
} from '../types';

export const INITIAL_FILES: FileItem[] = [
  {
    id: 'f-src',
    name: 'src',
    path: 'src',
    type: 'directory',
    children: [
      {
        id: 'f-com-example',
        name: 'com.example',
        path: 'src/com.example',
        type: 'directory',
        children: [
          {
            id: 'f-main-java',
            name: 'Main.java',
            path: 'src/com.example/Main.java',
            type: 'file',
            hasIssues: true,
            issueCount: 3,
          },
          {
            id: 'f-orderservice-java',
            name: 'OrderService.java',
            path: 'src/com.example/OrderService.java',
            type: 'file',
            hasIssues: true,
            issueCount: 1,
          },
          {
            id: 'f-validator-java',
            name: 'Validator.java',
            path: 'src/com.example/Validator.java',
            type: 'file',
            hasIssues: false,
          },
          {
            id: 'f-model',
            name: 'model',
            path: 'src/com.example/model',
            type: 'directory',
            children: [
              {
                id: 'f-order-java',
                name: 'Order.java',
                path: 'src/com.example/model/Order.java',
                type: 'file',
              },
              {
                id: 'f-user-java',
                name: 'User.java',
                path: 'src/com.example/model/User.java',
                type: 'file',
              },
            ],
          },
          {
            id: 'f-util',
            name: 'util',
            path: 'src/com.example/util',
            type: 'directory',
            children: [
              {
                id: 'f-constants-java',
                name: 'Constants.java',
                path: 'src/com.example/util/Constants.java',
                type: 'file',
              },
            ],
          },
        ],
      },
    ],
  },
];

export const INITIAL_JAVA_CODE = `package com.example;

import java.util.ArrayList;
import java.util.List;
import com.example.model.Order;

public class Main {

    private final Validator validator = new Validator();

    /**
     * Обработка списка заказов с валидацией и преобразованием.
     * Сложность: O(n²) из-за скрытых вложенных проверок.
     */
    public List<Order> processOrders(List<Order> orders) {
        List<Order> result = new ArrayList<>();

        if (orders == null || orders.isEmpty()) {
            return result;
        }

        for (Order order : orders) {
            if (validator.isValidOrder(order)) {
                Order processed = processOrder(order);
                result.add(processed);
            } else {
                continue;
            }
        }

        return result;
    }

    private Order processOrder(Order order) {
        order.setStatus("PROCESSED");
        order.setProcessedAt(System.currentTimeMillis());
        return order;
    }
}`;

export const OPTIMIZED_JAVA_CODE = `package com.example;

import java.util.List;
import java.util.Objects;
import java.util.stream.Collectors;
import com.example.model.Order;

public class Main {

    private final Validator validator = new Validator();

    /**
     * Оптимизированная обработка заказов.
     * Сложность: O(n log n) с параллельным Stream pipeline.
     */
    public List<Order> processOrders(List<Order> orders) {
        if (orders == null || orders.isEmpty()) {
            return List.of();
        }

        return orders.parallelStream()
            .filter(Objects::nonNull)
            .filter(validator::isValidOrder)
            .map(this::processOrder)
            .collect(Collectors.toList());
    }

    private Order processOrder(Order order) {
        order.setStatus("PROCESSED");
        order.setProcessedAt(System.currentTimeMillis());
        return order;
    }
}`;

export const PALETTE_ITEMS: BlockPaletteItem[] = [
  {
    type: 'variable',
    name: 'Переменная',
    description: 'Объявление или присвоение локальной переменной',
    defaultCode: 'List<Order> result = new ArrayList<>()',
    color: '#4294F7',
  },
  {
    type: 'condition',
    name: 'Условие',
    description: 'Ветвление логики (if/else)',
    defaultCode: 'orders == null || orders.isEmpty()',
    color: '#F4A34B',
  },
  {
    type: 'loop',
    name: 'Цикл',
    description: 'Итерация по коллекции (for / while)',
    defaultCode: 'for (Order order : orders)',
    color: '#A879F8',
  },
  {
    type: 'method',
    name: 'Метод',
    description: 'Точка входа или сигнатура функции',
    defaultCode: 'public List<Order> processOrders(List<Order> orders)',
    color: '#A879F8',
  },
  {
    type: 'operation',
    name: 'Операция',
    description: 'Выражение, вызов метода, мутация состояния',
    defaultCode: 'result.add(processed)',
    color: '#388BFD',
  },
  {
    type: 'return',
    name: 'Возврат',
    description: 'Завершение метода и возврат значения',
    defaultCode: 'return result',
    color: '#39C98A',
  },
];

export const INITIAL_NODES: Node<VisualBlockData>[] = [
  {
    id: 'node-method',
    type: 'methodNode',
    position: { x: 300, y: 30 },
    data: {
      title: 'Метод',
      codeSnippet: 'processOrders(List<Order> orders)',
      blockType: 'method',
      description: 'Точка входа сервиса заказов',
      badge: 'public List<Order>',
      warning: '42 строки (длинный метод)',
      line: 14,
    },
  },
  {
    id: 'node-var',
    type: 'variableNode',
    position: { x: 300, y: 140 },
    data: {
      title: 'Переменная',
      codeSnippet: 'List<Order> result = new ArrayList<>()',
      blockType: 'variable',
      description: 'Инициализация буфера результатов',
      badge: 'List<Order>',
      line: 15,
    },
  },
  {
    id: 'node-cond-null',
    type: 'conditionNode',
    position: { x: 215, y: 260 },
    data: {
      title: 'Условие (Guard Clause)',
      codeSnippet: 'orders == null || orders.isEmpty()',
      blockType: 'condition',
      description: 'Проверка на null или пустой список',
      badge: 'boolean',
      line: 17,
    },
  },
  {
    id: 'node-ret-early',
    type: 'returnNode',
    position: { x: -140, y: 340 },
    data: {
      title: 'Возврат',
      codeSnippet: 'return result',
      blockType: 'return',
      description: 'Ранний возврат пустого результата',
      badge: 'early exit',
      line: 18,
    },
  },
  {
    id: 'node-loop',
    type: 'loopNode',
    position: { x: 300, y: 560 },
    data: {
      title: 'Цикл',
      codeSnippet: 'for (Order order : orders)',
      blockType: 'loop',
      description: 'Итерация по каждому заказу',
      badge: 'O(n) pass',
      warning: 'Потенциальная вложенность O(n³)',
      line: 21,
    },
  },
  {
    id: 'node-cond-valid',
    type: 'conditionNode',
    position: { x: 215, y: 720 },
    data: {
      title: 'Условие валидации',
      codeSnippet: 'validator.isValidOrder(order)',
      blockType: 'condition',
      description: 'Бизнес-валидация заказа',
      badge: 'boolean',
      warning: 'Дублирование логики с OrderService',
      line: 22,
    },
  },
  {
    id: 'node-op-process',
    type: 'operationNode',
    position: { x: 300, y: 1030 },
    data: {
      title: 'Операция',
      codeSnippet: 'Order processed = processOrder(order)',
      blockType: 'operation',
      description: 'Преобразование статуса и временной метки',
      badge: 'apply transform',
      line: 23,
    },
  },
  {
    id: 'node-op-add',
    type: 'operationNode',
    position: { x: 300, y: 1160 },
    data: {
      title: 'Операция',
      codeSnippet: 'result.add(processed)',
      blockType: 'operation',
      description: 'Добавление обработанного заказа в результат',
      badge: 'collection mutate',
      line: 24,
    },
  },
  {
    id: 'node-op-continue',
    type: 'operationNode',
    position: { x: 740, y: 800 },
    data: {
      title: 'Продолжить (continue)',
      codeSnippet: 'continue',
      blockType: 'operation',
      description: 'Пропуск невалидного заказа',
      badge: 'flow control',
      line: 26,
    },
  },
  {
    id: 'node-method-external',
    type: 'methodNode',
    position: { x: 720, y: 1030 },
    data: {
      title: 'Метод (внешний вызов)',
      codeSnippet: 'processOrder(Order order)',
      blockType: 'method',
      description: 'Вызов локального метода трансформации',
      badge: 'private Order',
      line: 32,
    },
  },
  {
    id: 'node-ret-final',
    type: 'returnNode',
    position: { x: 300, y: 1290 },
    data: {
      title: 'Возврат',
      codeSnippet: 'return result',
      blockType: 'return',
      description: 'Финальный возврат сформированного списка',
      badge: 'final exit',
      line: 30,
    },
  },
];

export const INITIAL_EDGES: Edge[] = [
  {
    id: 'e-method-var',
    source: 'node-method',
    target: 'node-var',
    animated: true,
    style: { stroke: '#3B82F6', strokeWidth: 2 },
  },
  {
    id: 'e-var-cond',
    source: 'node-var',
    target: 'node-cond-null',
    animated: true,
    style: { stroke: '#3B82F6', strokeWidth: 2 },
  },
  {
    id: 'e-cond-yes-early',
    source: 'node-cond-null',
    sourceHandle: 'out-right',
    target: 'node-ret-early',
    label: 'Да',
    labelStyle: { fill: '#16A34A', fontWeight: 600, fontSize: 11 },
    labelBgStyle: { fill: '#F0FDF4', rx: 4, ry: 4, stroke: '#86EFAC' },
    style: { stroke: '#22C55E', strokeWidth: 2 },
  },
  {
    id: 'e-cond-no-loop',
    source: 'node-cond-null',
    sourceHandle: 'out-left',
    target: 'node-loop',
    label: 'Нет',
    labelStyle: { fill: '#EA580C', fontWeight: 600, fontSize: 11 },
    labelBgStyle: { fill: '#FFF7ED', rx: 4, ry: 4, stroke: '#FDBA74' },
    style: { stroke: '#F97316', strokeWidth: 2 },
  },
  {
    id: 'e-loop-valid',
    source: 'node-loop',
    target: 'node-cond-valid',
    label: 'Тело цикла',
    labelStyle: { fill: '#9333EA', fontWeight: 500, fontSize: 10 },
    labelBgStyle: { fill: '#FAF5FF', rx: 3, ry: 3, stroke: '#D8B4FE' },
    style: { stroke: '#A855F7', strokeWidth: 2 },
  },
  {
    id: 'e-valid-yes-process',
    source: 'node-cond-valid',
    sourceHandle: 'out-right',
    target: 'node-op-process',
    label: 'Да',
    labelStyle: { fill: '#16A34A', fontWeight: 600, fontSize: 11 },
    labelBgStyle: { fill: '#F0FDF4', rx: 4, ry: 4, stroke: '#86EFAC' },
    style: { stroke: '#22C55E', strokeWidth: 2 },
  },
  {
    id: 'e-process-add',
    source: 'node-op-process',
    target: 'node-op-add',
    style: { stroke: '#3B82F6', strokeWidth: 2 },
  },
  {
    id: 'e-valid-no-continue',
    source: 'node-cond-valid',
    sourceHandle: 'out-left',
    target: 'node-op-continue',
    targetHandle: 'in-left',
    label: 'Нет',
    labelStyle: { fill: '#DC2626', fontWeight: 600, fontSize: 11 },
    labelBgStyle: { fill: '#FEF2F2', rx: 4, ry: 4, stroke: '#FCA5A5' },
    style: { stroke: '#EF4444', strokeWidth: 2 },
  },
  {
    id: 'e-external-call',
    source: 'node-op-process',
    sourceHandle: 'out-right',
    target: 'node-method-external',
    targetHandle: 'in-left',
    style: { stroke: '#94A3B8', strokeWidth: 1.5, strokeDasharray: '4 4' },
  },
  {
    id: 'e-add-final',
    source: 'node-op-add',
    target: 'node-ret-final',
    label: 'Завершение цикла',
    labelStyle: { fill: '#64748B', fontSize: 10 },
    labelBgStyle: { fill: '#F1F5F9', rx: 3, ry: 3, stroke: '#CBD5E1' },
    style: { stroke: '#94A3B8', strokeWidth: 2 },
  },
];

export const OPTIMIZED_NODES: Node<VisualBlockData>[] = [
  {
    id: 'node-method-opt',
    type: 'methodNode',
    position: { x: 300, y: 30 },
    data: {
      title: 'Метод (Optimized)',
      codeSnippet: 'processOrders(List<Order> orders)',
      blockType: 'method',
      description: 'Stream-пайплайн параллельной обработки',
      badge: 'public List<Order>',
      line: 14,
    },
  },
  {
    id: 'node-cond-opt',
    type: 'conditionNode',
    position: { x: 260, y: 150 },
    data: {
      title: 'Guard Clause',
      codeSnippet: 'orders == null || orders.isEmpty()',
      blockType: 'condition',
      description: 'Мгновенный возврат константного пустого списка',
      badge: 'List.of() exit',
      line: 15,
    },
  },
  {
    id: 'node-stream-opt',
    type: 'operationNode',
    position: { x: 300, y: 370 },
    data: {
      title: 'Параллельный поток',
      codeSnippet: 'orders.parallelStream()',
      blockType: 'operation',
      description: 'Инициализация многопоточного ForkJoinPool',
      badge: 'ParallelStream',
      line: 19,
    },
  },
  {
    id: 'node-filter-opt',
    type: 'operationNode',
    position: { x: 300, y: 490 },
    data: {
      title: 'Фильтрация (O(1) hash check)',
      codeSnippet: '.filter(validator::isValidOrder)',
      blockType: 'operation',
      description: 'Быстрая фильтрация без дублирования состояния',
      badge: 'Stream.filter',
      line: 21,
    },
  },
  {
    id: 'node-map-opt',
    type: 'operationNode',
    position: { x: 300, y: 610 },
    data: {
      title: 'Маппинг преобразования',
      codeSnippet: '.map(this::processOrder)',
      blockType: 'operation',
      description: 'Параллельная трансформация объектов',
      badge: 'Stream.map',
      line: 22,
    },
  },
  {
    id: 'node-collect-opt',
    type: 'returnNode',
    position: { x: 300, y: 730 },
    data: {
      title: 'Сборка и возврат',
      codeSnippet: 'return .collect(Collectors.toList())',
      blockType: 'return',
      description: 'Эффективная финализация в результирующий список',
      badge: 'return List',
      line: 23,
    },
  },
];

export const OPTIMIZED_EDGES: Edge[] = [
  {
    id: 'e-opt-1',
    source: 'node-method-opt',
    target: 'node-cond-opt',
    animated: true,
    style: { stroke: '#39C98A', strokeWidth: 2 },
  },
  {
    id: 'e-opt-2',
    source: 'node-cond-opt',
    target: 'node-stream-opt',
    label: 'Нет',
    labelStyle: { fill: '#39C98A', fontWeight: 600, fontSize: 11 },
    labelBgStyle: { fill: '#151D29', rx: 4, ry: 4, stroke: '#39C98A' },
    style: { stroke: '#39C98A', strokeWidth: 2 },
  },
  {
    id: 'e-opt-3',
    source: 'node-stream-opt',
    target: 'node-filter-opt',
    animated: true,
    style: { stroke: '#4294F7', strokeWidth: 2 },
  },
  {
    id: 'e-opt-4',
    source: 'node-filter-opt',
    target: 'node-map-opt',
    animated: true,
    style: { stroke: '#4294F7', strokeWidth: 2 },
  },
  {
    id: 'e-opt-5',
    source: 'node-map-opt',
    target: 'node-collect-opt',
    animated: true,
    style: { stroke: '#39C98A', strokeWidth: 2 },
  },
];

export const INITIAL_ISSUES: CodeIssue[] = [
  {
    id: 'issue-1',
    title: 'Длинный метод',
    level: 'high',
    file: 'Main.java:12',
    line: 12,
    description: 'Метод processOrders содержит 42 строки. Рекомендуется выделить части логики в отдельные методы.',
    nodeId: 'node-method',
  },
  {
    id: 'issue-2',
    title: 'Дублирование логики',
    level: 'medium',
    file: 'Main.java:28',
    line: 28,
    description: 'Похожая проверка валидации встречается в OrderService.java и Validator.java. Рекомендуется вынести общую логику.',
    nodeId: 'node-cond-valid',
  },
  {
    id: 'issue-3',
    title: 'Вложенность O(n³)',
    level: 'medium',
    file: 'Main.java:31',
    line: 31,
    description: 'Вложенный цикл может иметь кубическую сложность. Проверьте, можно ли заменить повторный поиск индексированием.',
    nodeId: 'node-loop',
  },
];

export const INITIAL_RECOMMENDATIONS: CodeRecommendation[] = [
  {
    id: 'rec-1',
    title: 'Использовать Stream API',
    description: 'Замена императивного цикла for-each на stream().filter().map() повышает читаемость и исключает ручную мутацию буфера.',
    impact: 'high',
    tag: 'Архитектура',
  },
  {
    id: 'rec-2',
    title: 'Кэширование результатов валидации',
    description: 'Валидатор выполняет повторные запросы справочников. Примените локальный кэш (Memoization/HashMap).',
    impact: 'high',
    tag: 'Производительность',
  },
  {
    id: 'rec-3',
    title: 'Предварительная аллокация ArrayList',
    description: 'Инициализация new ArrayList<>(orders.size()) предотвращает многократный resize внутреннего массива при росте.',
    impact: 'medium',
    tag: 'Память',
  },
  {
    id: 'rec-4',
    title: 'Иммутабельный возврат List.of()',
    description: 'При пустых входных параметрах возвращайте неизменяемый пустой список List.of() вместо создания нового экземпляра.',
    impact: 'low',
    tag: 'Чистый код',
  },
];

export const INITIAL_METRICS: CodeMetrics = {
  cyclomaticComplexity: 6,
  linesOfCode: 42,
  nestingDepth: 3,
  testCoverage: 92,
  maintainabilityIndex: 78,
};

export const INITIAL_COMPLEXITY: ComplexityEstimate = {
  current: 'O(n²)',
  optimized: 'O(n log n)',
  speedup: 'до 5.2x',
  explanation: 'Замена вложенного обхода и валидации на хэш-индексирование и Stream pipeline снижает временную сложность с квадратичной до квазилинейной.',
};

export const INITIAL_CONSOLE_LOGS: ConsoleLog[] = [
  {
    id: 'log-1',
    timestamp: '18:24:12',
    type: 'info',
    message: 'Начата компиляция...',
  },
  {
    id: 'log-2',
    timestamp: '18:24:12',
    type: 'success',
    message: 'Компиляция успешна',
  },
  {
    id: 'log-3',
    timestamp: '18:24:12',
    type: 'info',
    message: 'Запуск программы...',
  },
  {
    id: 'log-4',
    timestamp: '18:24:12',
    type: 'info',
    message: 'Обработка данных (1523 элементов)...',
  },
  {
    id: 'log-5',
    timestamp: '18:24:12',
    type: 'success',
    message: 'Готово. Время выполнения: 1.24 сек.',
  },
  {
    id: 'log-6',
    timestamp: '18:24:12',
    type: 'info',
    message: 'Сравнение исходной и оптимизированной версии...',
  },
  {
    id: 'log-7',
    timestamp: '18:24:12',
    type: 'success',
    message: 'Поведение совпадает',
  },
];

export const INITIAL_TEST_CASES: TestCase[] = [
  {
    id: 't-1',
    name: 'testEmptyList',
    status: 'success',
    durationMs: 2,
    details: 'Возвращает пустой список без исключений',
  },
  {
    id: 't-2',
    name: 'testSingleOrder',
    status: 'success',
    durationMs: 8,
    details: 'Корректная трансформация одного элемента',
  },
  {
    id: 't-3',
    name: 'testInvalidOrder',
    status: 'success',
    durationMs: 5,
    details: 'Отсечение невалидных заказов',
  },
  {
    id: 't-4',
    name: 'testLargeDataset',
    status: 'success',
    durationMs: 142,
    details: '100_000 записей, валидация и сборка',
  },
];
