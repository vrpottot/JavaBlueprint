import { spawn } from 'node:child_process';
import type { ProcessResult } from '../types/index.js';
import { ApiError } from '../services/errors.js';

export function runProcess(command: string, args: string[], options: { stdin?: string; timeoutMs?: number; outputBytes?: number; cwd?: string } = {}): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(command, args, { cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let size = 0, timedOut = false, outputLimitExceeded = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, options.timeoutMs ?? 15000);
    const append = (chunks: Buffer[], data: Buffer) => {
      const remaining = (options.outputBytes ?? 1024 * 1024) - size;
      if (remaining > 0) chunks.push(data.subarray(0, remaining));
      size += data.length;
      if (size > (options.outputBytes ?? 1024 * 1024)) { outputLimitExceeded = true; child.kill('SIGKILL'); }
    };
    child.stdout.on('data', (data: Buffer) => append(stdout, data));
    child.stderr.on('data', (data: Buffer) => append(stderr, data));
    child.stdin.on('error', () => { /* Process may exit before consuming input. */ });
    child.on('error', (error) => { clearTimeout(timer); reject(new ApiError(503, 'PROCESS_UNAVAILABLE', `Cannot start ${command}: ${error.message}`)); });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), exitCode, durationMs: Math.round(performance.now() - started), timedOut, outputLimitExceeded });
    });
    child.stdin.end(options.stdin ?? '');
  });
}
