import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JavaParserEngine } from '../src/adapters/java-engine.js';

test('AST cost model composes independent sizes, logarithms, branches and local calls conservatively', async () => {
  const result = await new JavaParserEngine().process([{ path: 'Costs.java', content: `
import java.util.ArrayList;
class Costs {
  int constant(int n) { return n * 2 + 1; }
  int fixed(int n) { int x=0; for(int i=0;i<100;i++) x++; return x; }
  int linear(int n) { int x=0; for(int i=0;i<n;i++) x++; return x; }
  int logarithmic(int n) { int x=0; for(int i=n;i>0;i/=2) x++; return x; }
  int quadratic(int n) { int x=0; for(int i=0;i<n;i++) for(int j=0;j<n;j++) x++; return x; }
  int independent(int n,int m) { int x=0; for(int i=0;i<n;i++) for(int j=0;j<m;j++) x++; return x; }
  int sequential(int n,int m) { int x=0; for(int i=0;i<n;i++) x++; for(int j=0;j<m;j++) x++; return x; }
  int sameSize(int n) { int x=0; for(int i=0;i<n;i++) x++; for(int j=0;j<n;j++) x++; return x; }
  int mixed(int n) { int x=0; for(int i=0;i<n;i++) for(int j=n;j>0;j/=2) x++; return x; }
  int triangular(int n) { int x=0; for(int i=0;i<n;i++) for(int j=0;j<i;j++) x++; return x; }
  int withCall(int n) { int x=0; for(int i=0;i<n;i++) x+=linear(n); return x; }
  int array(int[] values) { int x=0; for(int v:values) x+=v; return x; }
  int whileLog(int n) { int x=0; while(n>0) { x++; n/=2; } return x; }
  int allocated(int n) { int[] values=new int[n]; return values.length; }
  boolean library(ArrayList<Integer> values,int x) { return values.contains(x); }
  int recursion(int n) { return n>0?recursion(n-1):0; }
  int unknown(int n) { return external(n); }
  int badStep(int n) { int x=0; for(int i=1;i<n;i*=2) x++; return x; }
  int changedBound(int n) { int x=0; for(int i=0;i<n;i++) { n++; x++; } return x; }
  int changedCounter(int n) { int x=0; for(int i=0;i<n;i++) { i--; x++; } return x; }
  int unbounded(int n) { while(true) { n++; } }
  int constantInner(int n) { int x=0; for(int i=0;i<n;i++) for(int j=0;j<10;j++) x++; return x; }
  int guarded(int n) { if(n>0) return linear(n); else return quadratic(n); }
  int tooWide(long n) { int x=0; for(int i=0;i<n;i++) x++; return x; }
}` }]);
  assert.deepEqual(result.errors, []);
  const estimates = Object.fromEntries(result.nodes.filter(n => n.kind === 'method').map(n => [n.title, n.complexity!]));
  const expected = { constant:'O(1)', fixed:'O(1)', linear:'O(n)', logarithmic:'O(log(n))', quadratic:'O(n^2)', independent:'O(m * n)', sequential:'O(m + n)', sameSize:'O(n)', mixed:'O(n * log(n))', triangular:'O(n^2)', withCall:'O(n^2)', array:'O(|values|)', whileLog:'O(log(n))', allocated:'O(n)', library:'O(|values|)', constantInner:'O(n)', guarded:'O(n^2)' };
  for (const [name, cost] of Object.entries(expected)) {
    assert.equal(estimates[name]!.estimate, cost, `${name}: ${JSON.stringify(estimates[name])}`);
    assert.ok(estimates[name]!.assumptions.length);
  }
  for (const name of ['recursion','unknown','badStep','changedBound','changedCounter','unbounded','tooWide']) {
    assert.equal(estimates[name]!.estimate, 'unknown', name);
    assert.ok(estimates[name]!.limitations.length, name);
  }
  assert.ok(estimates.quadratic!.evidence.some(e => e.rule.includes('счётчик')));
});
