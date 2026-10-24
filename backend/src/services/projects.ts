import { randomUUID } from 'node:crypto';
import type { EngineResult, SourceFile, Verification } from '../types/index.js';
import { ApiError } from './errors.js';

export interface Project {
  id: string; revision: number; original: SourceFile[]; result: EngineResult;
  touchedAt: number; verification?: Verification;
}
export class ProjectStore {
  private projects = new Map<string, Project>();
  constructor(private ttlMs = 7200000, private maxProjects = 50) {}
  clean() { for (const [id, p] of this.projects) if (Date.now() - p.touchedAt > this.ttlMs) this.projects.delete(id); }
  create(result: EngineResult) {
    this.clean();
    if (this.projects.size >= this.maxProjects) throw new ApiError(503, 'PROJECT_LIMIT', 'Project capacity reached; remove an old project or wait for expiration');
    const p: Project = { id: randomUUID(), revision: 0, original: structuredClone(result.files), result, touchedAt: Date.now() };
    this.projects.set(p.id, p);
    return p;
  }
  get(id: string) {
    this.clean();
    const project = this.projects.get(id);
    if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found or expired');
    project.touchedAt = Date.now();
    return project;
  }
  update(id: string, revision: number, result: EngineResult) {
    const p = this.get(id);
    if (p.revision !== revision) throw new ApiError(409, 'REVISION_CONFLICT', 'Project changed; reload the graph before editing');
    p.result = result; p.revision++; p.verification = undefined;
    return p;
  }
  delete(id: string) { this.get(id); this.projects.delete(id); }
}

export function validateFiles(files: SourceFile[]) {
  const names = new Set<string>();
  let bytes = 0;
  for (const file of files) {
    const segments = file.path.split('/');
    if (!file.path.endsWith('.java') || file.path.length > 240 || segments.some(s => !/^[A-Za-z0-9_$.-]+$/.test(s) || s === '.' || s === '..')) {
      throw new ApiError(400, 'INVALID_FILE_PATH', 'Use a relative .java path without traversal or special characters');
    }
    if (names.has(file.path)) throw new ApiError(400, 'DUPLICATE_FILE', `Duplicate path: ${file.path}`);
    names.add(file.path);
    bytes += Buffer.byteLength(file.content);
  }
  if (bytes > 2 * 1024 * 1024) throw new ApiError(413, 'SOURCE_LIMIT', 'Total Java source size must be at most 2 MiB');
}
