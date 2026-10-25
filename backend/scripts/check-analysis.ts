import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { JavaParserEngine } from '../src/adapters/java-engine.js';
import { DockerRunner } from '../src/adapters/docker-runner.js';
import { analyze } from '../src/services/analyzer.js';
import { graph } from '../src/services/graph.js';

// Manual JVM oracle for the completion paths represented by ControlFlow.
// Kept out of the short per-push suite; uses real JUnit inside the runner.
const index = process.argv.indexOf('--output');
const output = resolve(index >= 0 ? process.argv[index + 1]! : '/tmp/javascope-analysis-conformance');
await mkdir(output, { recursive: true });
const files = await Promise.all(['FlowCases.java', 'FlowCasesTest.java'].map(async path => ({
  path, content: await readFile(new URL(`../examples/analysis-conformance/${path}`, import.meta.url), 'utf8'),
})));
const begin = performance.now();
const parsed = await new JavaParserEngine().process(files);
assert.deepEqual(parsed.errors, []);
const parseMs = Math.round(performance.now() - begin);
const layout = graph(parsed);
assert.ok(layout.edges.every(edge => layout.nodes.some(node => node.id === edge.source) && layout.nodes.some(node => node.id === edge.target)));
assert.ok(parsed.nodes.some(node => node.astKind === 'Suppressed'));
assert.ok(parsed.nodes.some(node => node.originId && node.context?.includes('finally')));
const verification = await new DockerRunner().verify(files, files, {
  mainClass: 'FlowCases', compare: true, inputs: [{ name: 'completion oracle', stdin: '' }],
}, 1);
assert.equal(verification.current.compilation.exitCode, 0, verification.current.compilation.stderr);
assert.equal(verification.current.tests.status, 'passed', verification.current.tests.report);
assert.match(verification.current.tests.report ?? '', /10 tests successful/);
assert.equal(verification.comparison.status, 'matched_on_inputs');
const run = verification.current.runs[0]!;
assert.equal(run.exitCode, 0, run.stderr);
assert.match(run.stdout, /snapshot=1 \[try, finally:9\]/);
assert.match(run.stdout, /nested=7 \[body, inner, outer\]/);
assert.match(run.stdout, /suppressed:close:second, suppressed:close:first/);
assert.match(run.stdout, /self=true/);
const report = {
  created: new Date().toISOString(), parseMs, nodes: parsed.nodes.length, edges: parsed.edges.length,
  complexity: analyze(parsed).complexity, verification,
};
await writeFile(resolve(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
await writeFile(resolve(output, 'graph.json'), JSON.stringify(layout) + '\n');
console.log(`Completion oracle: 10 real JUnit tests passed; ${report.nodes} nodes, ${report.edges} edges. ${output}`);
