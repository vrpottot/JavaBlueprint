import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = [
  ['com/github/javaparser/javaparser-core/3.26.4/javaparser-core-3.26.4.jar', 'javaparser.jar'],
  ['com/google/code/gson/gson/2.12.1/gson-2.12.1.jar', 'gson.jar'],
  ['org/junit/platform/junit-platform-console-standalone/1.12.1/junit-platform-console-standalone-1.12.1.jar', 'junit.jar'],
];
await mkdir(`${root}java-engine/lib`, { recursive: true });
await mkdir(`${root}java-engine/build`, { recursive: true });
for (const [artifact, name] of artifacts) {
  const url = `https://repo.maven.apache.org/maven2/${artifact}`;
  const checksumResponse = await fetch(`${url}.sha1`);
  if (!checksumResponse.ok) throw new Error(`Cannot fetch checksum: ${url}`);
  const checksum = (await checksumResponse.text()).trim().split(/\s/)[0];
  const path = `${root}java-engine/lib/${name}`;
  let bytes;
  try { bytes = await readFile(path); } catch { /* Download below. */ }
  if (!bytes || createHash('sha1').update(bytes).digest('hex') !== checksum) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed: ${url}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha1').update(bytes).digest('hex') !== checksum) throw new Error(`Checksum mismatch: ${name}`);
    await writeFile(path, bytes);
  }
  console.log(`Ready: ${name}`);
}
const javac = process.env.JAVAC_BIN || 'javac';
const result = spawnSync(javac, ['-encoding', 'UTF-8', '-cp', 'java-engine/lib/*', '-d', 'java-engine/build', 'java-engine/src/Engine.java'], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
console.log('Java engine compiled');
