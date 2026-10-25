import { fileURLToPath } from 'node:url';
import { delimiter } from 'node:path';
import { runProcess } from './process.js';
import { ApiError } from '../services/errors.js';
import type { EngineResult, Identity, SourceFile, Transform } from '../types/index.js';

export const backendRoot = fileURLToPath(new URL('../../', import.meta.url));
export interface JavaEngine { process(files: SourceFile[], identities?: Identity[], operations?: Transform[]): Promise<EngineResult> }
export class JavaParserEngine implements JavaEngine {
  async process(files: SourceFile[], identities: Identity[] = [], operations: Transform[] = []): Promise<EngineResult> {
    const result = await runProcess(process.env.JAVA_BIN || 'java', [
      '-Dfile.encoding=UTF-8',
      '-Dsun.stdout.encoding=UTF-8',
      '-Dsun.stderr.encoding=UTF-8',
      '-Dsun.jnu.encoding=UTF-8',
      '-Xmx256m',
      '-Xss2m',
      '-cp',
      `${backendRoot}java-engine/build${delimiter}${backendRoot}java-engine/lib/*`,
      'Engine'
    ], {
      stdin: JSON.stringify({ files, identities, operations }), timeoutMs: 20000, outputBytes: 32 * 1024 * 1024,
    });
    if (result.timedOut || result.outputLimitExceeded) throw new ApiError(422, 'PARSER_LIMIT', 'Java parser exceeded its resource limit');
    if (result.exitCode !== 0) throw new ApiError(503, 'ENGINE_UNAVAILABLE', 'Java engine failed. Run npm run setup with JDK 21 installed.', result.stderr);
    const body = JSON.parse(result.stdout) as EngineResult & { error?: string };
    if (body.error) throw new ApiError(422, 'UNSUPPORTED_TRANSFORM', body.error);
    return body;
  }
}
