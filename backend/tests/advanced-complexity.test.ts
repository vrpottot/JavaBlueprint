import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JavaParserEngine } from '../src/adapters/java-engine.js';

test('cost contracts compose allocations, return sizes, streams, strings, queues and renamed binary search', async () => {
  const result = await new JavaParserEngine().process([{ path: 'Advanced.java', content: `
import java.util.*;
class Advanced {
  long sum(int[] a) { long s=0; for(int i=0;i<a.length;i++) { a[i]++; s+=a[i]; } return s; }
  List<Integer> build(int n) { List<Integer> items=new ArrayList<>(); for(int i=0;i<n;i++)items.add(i); return items; }
  void compose(int n,int m) { for(int value:build(n)) for(int j=0;j<m;j++) System.out.print(j); }
  String concat(int n) { String s=""; for(int i=0;i<n;i++)s+="x"; return s; }
  String builder(int n) { StringBuilder text=new StringBuilder(); for(int i=0;i<n;i++)text.append('x'); return text.toString(); }
  int renamed(int[] a,int key) { int start=0; int stop=a.length; while(start<stop) { int pivot=start+(stop-start)/2; if(a[pivot]<key)start=pivot+1;else stop=pivot; } return start; }
  int pqHead(PriorityQueue<Integer> q) { return q.remove(); }
  boolean pqValue(PriorityQueue<Integer> q,Integer value) { return q.remove(value); }
  boolean dequeValue(ArrayDeque<Integer> q,Integer value) { return q.remove(value); }
  int arbitrary(int n) { return external(n); }
  int arrayBound(int[] a) { int x=0; for(int i=0;i<a[0];i++) { a[0]++; x++; } return x; }
  int inclusive(int n) { int x=0; for(int i=0;i<=n;i++)x++; return x; }
  int skip(int n) { int x=0; for(int i=0;i<n;i++) {i++; x++;} return x; }
  int badMidpoint(int[] a,int key) { int l=0; int r=a.length; while(l<r) {int mid=l+(r-l)/2; mid=l; if(a[mid]<key)l=mid+1;else r=mid;} return l; }
  void growing(List<Integer> values) { for(int value:values) { List<Integer> alias=values; alias.add(value); } }
  int exponential(int n) { if(n<=1)return n; return exponential(n-1)+exponential(n-2); }
  int first(List<Integer> values) { return values.get(0); }
  int mix(int n) { List<Integer> a=new ArrayList<>(); List<Integer> b=new LinkedList<>(); for(int i=0;i<n;i++)a.add(i); for(int i=0;i<n;i++)b.add(i); int x=first(a); for(int i=0;i<n;i++)x+=first(b); return x; }
  static class Base { int work(int n) { return 0; } }
  static final class Child extends Base { int work(int n) { int x=0; for(int i=0;i<n;i++)for(int j=0;j<n;j++)x++; return x; } }
  int virtual(Base value,int n) { return value.work(n); }
  static final class Slow { int n; public String toString() { int x=0; for(int i=0;i<n;i++)for(int j=0;j<n;j++)x++; return ""+x; } }
  void printing(Slow value) { System.out.println(value); }
  String copies(int n) { StringBuilder b=new StringBuilder(); String text=""; for(int i=0;i<n;i++) {b.append('x'); text=b.toString();} return text; }
  final StringBuilder buffer=new StringBuilder();
  void fill(int n) { for(int i=0;i<n;i++)buffer.append('x'); }
  int fieldGrowth(int n) { fill(n); int x=0; for(int i=0;i<n;i++)x+=buffer.toString().length(); return x; }
  int mutatedRecursion(int n) { if(n<=1)return 1; n++; return mutatedRecursion(n-1); }
  String joined(List<String> texts) { return texts.stream().collect(java.util.stream.Collectors.joining()); }
  int maxWithWork(List<Integer> values,int n) { return values.stream().max((a,b)->{ int x=0; for(int i=0;i<n;i++)for(int j=0;j<n;j++)x++; return Integer.compare(a,b); }).orElse(0); }
  int lateBase(int n) { int x=lateBase(n-1); if(n<=1)return 0; return x; }
  int conditionalBase(int n,boolean flag) { if(flag) { if(n<=1)return 0; } return conditionalBase(n-1,flag); }
  void unsafeQueue(List<List<Integer>> graph,boolean[] seen) { ArrayDeque<Integer> q=new ArrayDeque<>(); q.add(0); while(!q.isEmpty() || true) { int u=q.remove(); for(int v:graph.get(u)) { if(!seen[v]) { seen[v]=true; q.add(v); } } } }
  void conditionalMark(List<List<Integer>> graph,boolean[] seen,boolean flag) { ArrayDeque<Integer> q=new ArrayDeque<>(); q.add(0); while(!q.isEmpty()) { int u=q.remove(); for(int v:graph.get(u)) { if(!seen[v]) { if(flag)seen[v]=true; q.add(v); } } } }
}` }]);
  assert.deepEqual(result.errors, []);
  const costs = new Map(result.nodes.filter(node => node.kind === 'method').map(node => [node.title, node.complexity!]));
  for (const [name, expected] of Object.entries({ sum: 'O(|a|)', build: 'O(n)', compose: 'O(m * n)', concat: 'O(n^2)', builder: 'O(n)', renamed: 'O(log(|a|))', pqHead: 'O(log(|q|))', pqValue: 'O(|q|)', dequeValue: 'O(|q|)', exponential: 'O(2^(n))', mix: 'O(n^2)', virtual: 'O(n^2)', copies: 'O(n^2)' })) {
    assert.equal(costs.get(name)!.estimate, expected, `${name}: ${JSON.stringify(costs.get(name))}`);
  }
  assert.match(costs.get('printing')!.estimate, /value.n\^2/);
  assert.match(costs.get('fieldGrowth')!.estimate, /n\^2/);
  assert.match(costs.get('joined')!.estimate, /max\(\|stream text element\|\)/);
  assert.equal(costs.get('maxWithWork')!.estimate, 'O(n^2 * |values|)');
  for (const name of ['arbitrary', 'arrayBound', 'inclusive', 'skip', 'badMidpoint', 'growing', 'mutatedRecursion', 'lateBase', 'conditionalBase', 'unsafeQueue', 'conditionalMark']) {
    assert.equal(costs.get(name)!.status, 'unknown', `${name}: ${JSON.stringify(costs.get(name))}`);
    assert.ok(costs.get(name)!.limitations.length);
  }
});
