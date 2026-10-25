import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JavaParserEngine } from '../src/adapters/java-engine.js';
import type { EngineResult } from '../src/types/index.js';

function reaches(ir: EngineResult, from: string, target: string, allowed = (label: string) => true) {
  const pending = [from], seen = new Set<string>();
  while (pending.length) {
    const node = pending.pop()!;
    if (node === target) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    pending.push(...ir.edges.filter(edge => edge.source === node && allowed(edge.label ?? '')).map(edge => edge.target));
  }
  return false;
}

test('finally routes preserve pending return, nested cleanup, labeled jumps and return overrides', async () => {
  const engine = new JavaParserEngine();
  const ir = await engine.process([{ path: 'Flow.java', content: `class Flow {
    int x;
    int returning(boolean flag) { try { if(flag) return x++; x=3; } finally { x=4; } x=5; return x; }
    int override() { try { return 1; } finally { return 2; } }
    int nested() { try { try { return 1; } finally { x=10; } } finally { x=20; } }
    void jumps(int n) { outer: for(int i=0;i<n;i++) { try { if(i==1) continue outer; break outer; } finally { x++; } } x=99; }
  }` }]);
  assert.deepEqual(ir.errors, []);
  const find = (code: string) => ir.nodes.filter(node => node.code === code);
  const early = find('return x++;')[0]!;
  const after = find('x = 5;')[0]!;
  assert.ok(!reaches(ir, early.id, after.id), 'return through finally must not fall through into code after try');
  const cleanup = find('x = 4;').find(node => reaches(ir, early.id, node.id))!;
  assert.ok(cleanup, 'return must execute finally');
  const without = (nodeId: string) => ({ ...ir, edges: ir.edges.filter(edge => edge.source !== nodeId && edge.target !== nodeId) });
  const exit = ir.nodes.find(node => node.methodId === early.methodId && node.astKind === 'Completion' && node.title === 'Выход')!;
  assert.ok(!reaches(without(cleanup.id), early.id, exit.id), 'there must be no path bypassing cleanup on return');
  assert.ok(ir.edges.some(edge => edge.source === cleanup.id && ir.nodes.some(node => node.id === edge.target && node.astKind === 'Resume')));
  const overridden = ir.nodes.find(node => node.code === 'return 1;' && node.methodId === ir.nodes.find(n => n.title === 'override')!.id)!;
  const winner = ir.nodes.find(node => node.code === 'return 2;')!;
  assert.ok(reaches(ir, overridden.id, winner.id));
  assert.ok(!ir.nodes.some(node => node.methodId === overridden.methodId && node.astKind === 'Resume' && reaches(ir, overridden.id, node.id)));
  const nestedReturn = ir.nodes.find(node => node.code === 'return 1;' && node.methodId === ir.nodes.find(n => n.title === 'nested')!.id)!;
  const inner = find('x = 10;').find(node => reaches(ir, nestedReturn.id, node.id))!;
  const outer = find('x = 20;').find(node => reaches(ir, inner.id, node.id))!;
  assert.ok(inner && outer, 'nested finalizers must execute inside out');
  assert.ok(!reaches(without(inner.id), nestedReturn.id, outer.id), 'outer cleanup cannot bypass inner cleanup');
  const jump = ir.nodes.find(node => node.code === 'continue outer;')!;
  assert.ok(ir.edges.some(edge => edge.source === jump.id && !edge.target.startsWith(ir.nodes.find(node => node.astKind === 'ForStmt')!.id)));
  assert.ok(find('x++;').some(node => reaches(ir, jump.id, node.id)));
  const edited = await engine.process(ir.files, ir.identities, [{ type: 'replaceStatement', nodeId: cleanup.id, code: 'x = 40;' }]);
  assert.deepEqual(edited.errors, []);
  assert.ok(edited.files[0]!.content.includes('x = 40;'));
  assert.ok(!edited.nodes.some(node => node.code === 'x = 4;'));
});

test('known throw types select the first compatible catch and self-suppression has its own exceptional path', async () => {
  const ir = await new JavaParserEngine().process([{ path: 'Typed.java', content: `class Typed {
    int x;
    void ordered() { try { throw new java.io.IOException(); }
      catch(IllegalArgumentException e) { x=1; } catch(java.io.IOException e) { x=2; } catch(Exception e) { x=3; } finally { x=4; } }
    void resources() { try(AutoCloseable resource=() -> {}) { throw new java.io.IOException(); }
      catch(IllegalArgumentException e) { x=5; } catch(Exception e) { x=6; } }
    int expression(int n) throws java.io.IOException { try { return switch(n) { case 0 -> throw new java.io.IOException(); default -> 1; }; } finally { x=7; } }
    void assertion() { try { assert x>0; } finally { x=8; } }
  }` }]);
  assert.deepEqual(ir.errors, []);
  const scope = ir.nodes.find(node => node.title === 'ordered')!.id;
  const thrown = ir.nodes.find(node => node.methodId === scope && node.astKind === 'ThrowStmt')!;
  const explicit = ir.edges.find(edge => edge.source === thrown.id && edge.label === 'throw IOException')!;
  const dispatch = ir.edges.filter(edge => edge.source === explicit.target);
  assert.equal(dispatch.length, 1);
  assert.match(dispatch[0]!.label ?? '', /IOException/);
  assert.ok(reaches(ir, explicit.target, ir.nodes.find(node => node.code === 'x = 2;')!.id));
  assert.ok(!reaches(ir, explicit.target, ir.nodes.find(node => node.code === 'x = 1;')!.id));
  const self = ir.edges.find(edge => edge.label?.startsWith('self-suppression'))!;
  assert.ok(self);
  const selected = ir.edges.filter(edge => edge.source === self.target);
  assert.equal(selected.length, 1);
  assert.match(selected[0]!.label ?? '', /IllegalArgumentException/);
  for (const name of ['expression', 'assertion']) {
    const method = ir.nodes.find(node => node.title === name)!;
    const abrupt = ir.nodes.find(node => node.methodId === method.id && node.astKind === (name === 'expression' ? 'ReturnStmt' : 'AssertStmt'))!;
    const exception = ir.edges.find(edge => edge.source === abrupt.id && edge.kind === 'exception')!;
    assert.ok(exception, `${name} can fail before normal completion`);
    assert.ok(ir.nodes.some(node => node.originId && node.methodId === method.id && reaches(ir, exception.target, node.id)), `${name} exception must pass through finally`);
  }
});

test('resource initialization, reverse close order, suppression and typed catch selection are explicit', async () => {
  const ir = await new JavaParserEngine().process([{ path: 'Resources.java', content: `class Resources {
    static class R implements AutoCloseable { public void close() throws java.io.IOException {} }
    void use() { try(R first=new R(); R second=new R()) { throw new java.io.IOException(); }
      catch(java.io.IOException e) { System.out.println("caught"); }
      finally { System.out.println("finally"); } }
  }` }]);
  assert.deepEqual(ir.errors, []);
  const nodes = ir.nodes as (EngineResult['nodes'][number] & { resource?: string; completion?: string })[];
  const thrown = nodes.find(node => node.astKind === 'ThrowStmt')!;
  const explicit = ir.edges.find(edge => edge.source === thrown.id && edge.label === 'throw IOException')!;
  assert.ok(explicit);
  const second = nodes.find(node => node.astKind === 'ResourceClose' && node.resource === 'second' && reaches(ir, explicit.target, node.id))!;
  const caught = nodes.find(node => node.astKind === 'Catch')!;
  const first = nodes.find(node => node.astKind === 'ResourceClose' && node.resource === 'first' && reaches(ir, second.id, node.id) && reaches(ir, node.id, caught.id))!;
  assert.ok(second && first && reaches(ir, first.id, caught.id), 'resources close before catch');
  const suppressed = nodes.find(node => node.astKind === 'Suppressed' && reaches(ir, second.id, node.id) && reaches(ir, node.id, caught.id))!;
  assert.ok(suppressed && reaches(ir, suppressed.id, caught.id), 'close failure preserves the primary exception');
  const init = nodes.find(node => node.astKind === 'ResourceInit' && node.code.includes('second'))!;
  const initFailure = ir.edges.find(edge => edge.source === init.id && edge.label === 'ошибка инициализации')!;
  const failureCloses = nodes.filter(node => node.astKind === 'ResourceClose' && reaches(ir, initFailure.target, node.id));
  assert.ok(failureCloses.some(node => node.resource === 'first'));
  assert.ok(!failureCloses.some(node => node.resource === 'second'), 'uninitialized resource must not close');
  assert.ok(nodes.filter(node => node.code === 'System.out.println("finally");').some(node => reaches(ir, caught.id, node.id)));
});
