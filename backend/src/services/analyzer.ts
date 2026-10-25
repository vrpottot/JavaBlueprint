import type { EngineResult, IRNode } from '../types/index.js';

export function analyze(result: EngineResult) {
  const canonical = [...new Map(result.nodes.filter(node => !node.synthetic).map(node => [node.originId ?? node.id, node])).values()];
  const diagnostics: { id: string; type: string; severity: 'high' | 'medium' | 'low'; title: string; description: string; file: string; line: number; nodeId: string; recommendation: string }[] = [];
  const add = (n: IRNode, type: string, title: string, description: string, recommendation: string) => diagnostics.push({
    id: `${n.id}:${type}`, type, severity: 'medium', title, description, recommendation,
    file: n.source.file, line: n.source.startLine, nodeId: n.id,
  });
  const methods = canonical.filter(n => n.kind === 'method');
  const duplicates = new Map<string, IRNode>();
  for (const n of canonical) {
    if (n.kind === 'method' && n.source.endLine - n.source.startLine + 1 > 50) add(n, 'long_method', 'Длинный метод', 'Метод занимает больше 50 строк.', 'Выделите самостоятельные операции в отдельные методы.');
    if (n.kind === 'loop' && n.loopDepth > 0) add(n, 'nested_loop', 'Вложенный цикл', 'Число итераций может расти как произведение размеров обходов. Это структурный признак, а не доказанная Big O.', 'Проверьте возможность индексирования или использования Set/Map.');
    if (n.kind === 'loop' && /\.size\(\)|\.length\(\)/.test(n.snippet)) add(n, 'loop_bound_call', 'Вызов в границе цикла', 'В условии цикла есть вызов метода. Его стоимость и постоянство требуют проверки.', 'Если значение неизменно и вызов дорогой, вычислите его до цикла.');
    if (n.kind === 'operation' && n.code.length > 35 && n.code.length < 2000 && n.astKind === 'ExpressionStmt') {
      // Exact AST pretty-printed statement match; whitespace inside string literals is significant.
      const previous = duplicates.get(n.code);
      if (previous) add(n, 'duplicate_statement', 'Повторяющаяся операция', `Такая же операция встречается в ${previous.source.file}:${previous.source.startLine}.`, 'Проверьте, можно ли вынести повтор в общий метод.');
      else duplicates.set(n.code, n);
    }
  }
  const complexity = methods.map(m => {
    const body = canonical.filter(n => n.methodId === m.id);
    const loops = body.filter(n => n.kind === 'loop');
    const depth = Math.max(0, ...loops.map(n => n.loopDepth + 1));
    return {
      methodId: m.id, method: m.title, file: m.source.file, line: m.source.startLine,
      structuralBound: depth ? depth === 1 ? 'O(n)' : `O(n^${depth})` : 'O(1)',
      ...(m.complexity ?? { estimate: 'unknown', status: 'unknown', assumptions: [], limitations: ['AST cost model unavailable'], evidence: [], explanation: 'Модель стоимости AST недоступна.' }),
    };
  });
  return {
    diagnostics, complexity,
    metrics: {
      linesOfCode: result.files.reduce((sum, f) => sum + f.content.split('\n').length, 0),
      cyclomaticComplexity: methods.length + canonical.filter(n => n.kind === 'condition' || n.kind === 'loop').length,
      nestingDepth: Math.max(0, ...canonical.map(n => n.depth)),
      testCoverage: null, maintainabilityIndex: null,
      limitations: 'Cyclomatic complexity is a structural lower bound; boolean short-circuits and individual switch labels are not counted. Coverage is not measured.',
    },
  };
}
