import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runProcess } from './process.js';
import { ApiError } from '../services/errors.js';
import { validateFiles } from '../services/projects.js';
import type { InputCase, ProcessResult, SourceFile, Verification, VerifyRequest, VersionResult } from '../types/index.js';

export interface Runner { verify(original: SourceFile[], current: SourceFile[], request: VerifyRequest, revision: number): Promise<Verification> }
export class DockerRunner implements Runner {
  private active = 0;
  constructor(private docker = process.env.DOCKER_BIN || 'docker', private image = process.env.RUNNER_IMAGE || 'javablueprint-runner:local') {}
  private async command(args: string[], stdin?: string, timeoutMs = 15000): Promise<ProcessResult> {
    return runProcess(this.docker, args, { stdin, timeoutMs, outputBytes: 1024 * 1024 });
  }
  private async requireReady() {
    const info = await this.command(['info', '--format', '{{json .}}']);
    if (info.exitCode !== 0) throw new ApiError(503, 'RUNNER_UNAVAILABLE', 'Docker is unavailable; start Docker and build the runner image');
    const capabilities = JSON.parse(info.stdout) as Record<string, unknown>;
    if (!capabilities.MemoryLimit || !capabilities.PidsLimit || !capabilities.CpuCfsQuota) throw new ApiError(503, 'RUNNER_LIMITS_UNAVAILABLE', 'Docker must enforce memory, PID and CPU limits (rootless Docker needs delegated cgroups)');
    const image = await this.command(['image', 'inspect', this.image]);
    if (image.exitCode !== 0) throw new ApiError(503, 'RUNNER_IMAGE_MISSING', 'Build the Java runner with npm run runner:build');
  }
  private limits(name: string) {
    return ['--name', name, '--network=none', '--read-only', '--user=10001:10001', '--cap-drop=ALL',
      '--security-opt=no-new-privileges', '--memory=256m', '--memory-swap=256m', '--cpus=1', '--pids-limit=96',
      '--ulimit=nofile=128:128', '--ulimit=core=0:0', '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777',
      '--env=LANG=C.UTF-8', '--env=LC_ALL=C.UTF-8'];
  }
  private async isolated(args: string[], stdin: string, timeoutMs: number) {
    const name = `jbp-${randomUUID()}`;
    try {
      const result = await this.command(['run', '--pull=never', '-i', ...this.limits(name), ...args], stdin, timeoutMs);
      if (result.exitCode === 125 || result.exitCode === 126 || result.exitCode === 127) throw new ApiError(503, 'RUNNER_FAILED', 'Docker could not start the isolated Java process', result.stderr);
      return result;
    } finally {
      const removed = await this.command(['rm', '-f', name], undefined, 5000);
      if (removed.exitCode !== 0 && !/No such container/.test(removed.stderr)) throw new ApiError(503, 'RUNNER_CLEANUP_FAILED', 'Docker could not clean up a runner container');
    }
  }
  private async version(files: SourceFile[], tests: SourceFile[], mainClass: string | undefined, inputs: InputCase[]): Promise<VersionResult> {
    const allFiles = [...files, ...tests];
    validateFiles(allFiles);
    const staging = await mkdtemp(join(tmpdir(), 'jbp-'));
    const volume = `jbp-classes-${randomUUID()}`;
    let volumeCreated = false;
    try {
      await chmod(staging, 0o755);
      for (const file of allFiles) {
        const destination = join(staging, file.path);
        await mkdir(dirname(destination), { recursive: true, mode: 0o755 });
        await writeFile(destination, file.content, { mode: 0o644 });
      }
      const created = await this.command(['volume', 'create', volume]);
      if (created.exitCode !== 0) throw new ApiError(503, 'RUNNER_FAILED', 'Cannot create compilation volume');
      volumeCreated = true;
      const compilation = await this.isolated([
        '--mount', `type=bind,src=${staging},dst=/input,readonly`,
        '--mount', `type=volume,src=${volume},dst=/classes`, this.image,
        'javac', '-J-Xmx160m', '-J-XX:ActiveProcessorCount=1', '-proc:none', '-encoding', 'UTF-8', '--release', '21',
        '-cp', '/opt/junit.jar', '-d', '/classes', ...allFiles.map(f => `/input/${f.path}`),
      ], '', 25000);
      const version: VersionResult = { compilation, runs: [], tests: { status: 'not_run', cases: [] } };
      if (compilation.exitCode !== 0 || compilation.timedOut || compilation.outputLimitExceeded) return version;
      const mount = ['--mount', `type=volume,src=${volume},dst=/classes,readonly`, this.image];
      const java = ['java', '-Xmx128m', '-XX:ActiveProcessorCount=1', '-XX:+DisableAttachMechanism', '-Dfile.encoding=UTF-8'];
      if (mainClass) for (const input of inputs) {
        const result = await this.isolated([...mount, ...java, '-cp', '/classes', mainClass, ...(input.args ?? [])], input.stdin, 5000);
        version.runs.push({ ...result, name: input.name, passed: input.expectedStdout === undefined ? null : result.exitCode === 0 && !result.timedOut && !result.outputLimitExceeded && result.stdout === input.expectedStdout });
      }
      if (tests.length || files.some(f => /\bimport\s+org\.junit\./.test(f.content))) {
        const execution = await this.isolated([...mount, ...java, '-jar', '/opt/junit.jar', 'execute', '--class-path', '/classes', '--scan-class-path', '--include-classname=.*', '--disable-banner', '--disable-ansi-colors', '--details=tree', '--fail-if-no-tests'], '', 15000);
        const found = Number(execution.stdout.match(/\[\s*(\d+) tests found\s*\]/)?.[1] ?? 0);
        const passed = execution.exitCode === 0 && !execution.timedOut && !execution.outputLimitExceeded && found > 0;
        version.tests = {
          status: passed ? 'passed' : 'failed', execution, report: execution.stdout,
          cases: [{ id: 'junit-suite', name: `JUnit 5 (${found} tests found)`, status: passed ? 'success' : 'failure', durationMs: execution.durationMs, details: execution.stdout + execution.stderr }],
        };
      }
      return version;
    } finally {
      try {
        if (volumeCreated) {
          const removed = await this.command(['volume', 'rm', '-f', volume], undefined, 5000);
          if (removed.exitCode !== 0) throw new ApiError(503, 'RUNNER_CLEANUP_FAILED', 'Docker could not clean up compilation files');
        }
      } finally { await rm(staging, { recursive: true, force: true }); }
    }
  }
  async verify(original: SourceFile[], current: SourceFile[], request: VerifyRequest, revision: number): Promise<Verification> {
    if (this.active >= Number(process.env.MAX_RUNNER_JOBS || 2)) throw new ApiError(429, 'RUNNER_BUSY', 'Verification capacity reached; retry shortly');
    this.active++;
    try {
      await this.requireReady();
      const inputs = request.mainClass ? request.inputs ?? [{ name: 'main', stdin: '' }] : [];
      if (request.inputs?.length && !request.mainClass) throw new ApiError(400, 'MAIN_CLASS_REQUIRED', 'mainClass is required when providing inputs');
      const result: Verification = {
        revision, current: await this.version(current, request.tests ?? [], request.mainClass, inputs),
        comparison: { status: 'not_requested', checkedInputs: 0, provenEquivalent: false, explanation: 'Compilation, test success and behavior comparison are separate results.' },
      };
      if (request.compare) {
        result.original = await this.version(original, request.tests ?? [], request.mainClass, inputs);
        result.comparison = compareVersions(result.original, result.current, inputs.length);
      }
      return result;
    } finally { this.active--; }
  }
}

export function compareVersions(original: VersionResult, current: VersionResult, inputCount: number): Verification['comparison'] {
  const successful = (v: VersionResult) => v.compilation.exitCode === 0 && !v.compilation.timedOut && !v.compilation.outputLimitExceeded && v.tests.status !== 'failed'
    && v.runs.length === inputCount && v.runs.every(r => r.exitCode === 0 && !r.timedOut && !r.outputLimitExceeded && r.passed !== false);
  if (inputCount === 0 || !successful(original) || !successful(current)) return {
    status: 'inconclusive', checkedInputs: 0, provenEquivalent: false,
    explanation: 'Behavior comparison requires successful compilation and execution on identical explicit inputs. Tests alone do not prove equivalence.',
  };
  const equal = original.runs.every((r, i) => r.stdout === current.runs[i]?.stdout && r.stderr === current.runs[i]?.stderr && r.exitCode === current.runs[i]?.exitCode);
  return { status: equal ? 'matched_on_inputs' : 'different', checkedInputs: inputCount, provenEquivalent: false,
    explanation: equal ? 'Observed stdout, stderr and exit codes match on these inputs only. Full program equivalence is not proven.' : 'Observed stdout, stderr or exit codes differ on at least one identical input.' };
}
