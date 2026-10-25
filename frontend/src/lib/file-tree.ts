import type { FileItem } from '../types';
import type { SourceFile } from '../services/api';

/**
 * Clean and normalize file path, stripping common outer folder wrapper if present,
 * but preserving 'src/...' or package paths.
 */
export function normalizeRelativePath(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/');
  
  if (parts.length <= 1) return normalized;

  // If first segment is e.g. "my-project" and second is "src", strip "my-project"
  if (parts.length > 2 && parts[1] === 'src') {
    return parts.slice(1).join('/');
  }

  // If starts with "src", keep as-is
  if (parts[0] === 'src') {
    return normalized;
  }

  return normalized;
}

/**
 * Builds a hierarchical FileItem tree from a flat list of SourceFiles.
 */
export function buildFileTree(files: SourceFile[]): FileItem[] {
  if (!files || files.length === 0) return [];

  // Check if any file path contains "/"
  const hasSubdirectories = files.some((f) => f.path.includes('/'));

  if (!hasSubdirectories) {
    return files.map((f) => ({
      id: f.path,
      path: f.path,
      name: f.path,
      type: 'file' as const,
    }));
  }

  interface InternalDir {
    id: string;
    name: string;
    path: string;
    dirs: Map<string, InternalDir>;
    files: FileItem[];
  }

  const root: InternalDir = {
    id: 'root',
    name: '',
    path: '',
    dirs: new Map(),
    files: [],
  };

  for (const file of files) {
    const normalized = file.path.replace(/\\/g, '/').replace(/^\/+/, '');
    const parts = normalized.split('/');
    const fileName = parts.pop() || normalized;

    let current = root;
    let accumulatedPath = '';
    for (const part of parts) {
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part;
      if (!current.dirs.has(part)) {
        current.dirs.set(part, {
          id: `dir:${accumulatedPath}`,
          name: part,
          path: accumulatedPath,
          dirs: new Map(),
          files: [],
        });
      }
      current = current.dirs.get(part)!;
    }

    current.files.push({
      id: file.path,
      name: fileName,
      path: file.path,
      type: 'file',
    });
  }

  function convert(node: InternalDir): FileItem[] {
    const result: FileItem[] = [];

    // Sort directories alphabetically (with 'src' first if present)
    const sortedDirs = Array.from(node.dirs.values()).sort((a, b) => {
      if (a.name === 'src') return -1;
      if (b.name === 'src') return 1;
      return a.name.localeCompare(b.name);
    });

    for (const dir of sortedDirs) {
      result.push({
        id: dir.id,
        name: dir.name,
        path: dir.path,
        type: 'directory',
        children: convert(dir),
      });
    }

    // Sort files alphabetically
    const sortedFiles = node.files.sort((a, b) => a.name.localeCompare(b.name));
    for (const file of sortedFiles) {
      result.push(file);
    }

    return result;
  }

  return convert(root);
}

/**
 * Traverses DataTransferItemList to recursively extract all .java files from dropped files/folders.
 */
export async function getFilesFromDataTransfer(items: DataTransferItemList): Promise<Array<{ path: string; content: string }>> {
  const entries: any[] = [];
  const directFiles: File[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (typeof (item as any).webkitGetAsEntry === 'function') {
      const entry = (item as any).webkitGetAsEntry();
      if (entry) entries.push(entry);
    } else if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file && file.name.endsWith('.java')) {
        directFiles.push(file);
      }
    }
  }

  const results: Array<{ path: string; content: string }> = [];

  for (const file of directFiles) {
    results.push({ path: file.name, content: await file.text() });
  }

  async function traverse(entry: any, currentPath: string): Promise<void> {
    if (!entry) return;
    if (entry.isFile) {
      if (entry.name.endsWith('.java')) {
        const file: File = await new Promise((resolve, reject) => entry.file(resolve, reject));
        const relativePath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
        const content = await file.text();
        results.push({ path: normalizeRelativePath(relativePath), content });
      }
    } else if (entry.isDirectory) {
      // Ignore hidden or build folders
      if (['.git', '.idea', 'node_modules', 'target', 'build', '.gradle', 'bin', '.vscode'].includes(entry.name)) {
        return;
      }
      const dirReader = entry.createReader();
      const readEntries = (): Promise<any[]> =>
        new Promise((resolve, reject) => dirReader.readEntries(resolve, reject));

      let batch = await readEntries();
      while (batch.length > 0) {
        for (const child of batch) {
          const nextPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
          await traverse(child, nextPath);
        }
        batch = await readEntries();
      }
    }
  }

  for (const entry of entries) {
    await traverse(entry, '');
  }

  return results;
}
