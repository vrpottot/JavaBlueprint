import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const destination = resolve(process.argv[2] || '/tmp/javascope-jury/tools');
await mkdir(destination, { recursive: true });
for (const [artifact, filename, checksum] of [
  ['org.jacoco.agent/0.8.14/org.jacoco.agent-0.8.14-runtime.jar', 'agent.jar', '3fb76eea65f81bd9415202bab34b6571728841dff1ab8e6bbe81adc2e299face'],
  ['org.jacoco.cli/0.8.14/org.jacoco.cli-0.8.14-nodeps.jar', 'cli.jar', '811c7f8c6b358c5d68a8973cfa867f6892be7a671b697a4b13c4b447e6daf75c'],
]) {
  const target = resolve(destination, filename);
  let bytes;
  try { bytes = await readFile(target); } catch { /* Download the pinned tool below. */ }
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== checksum) {
    const response = await fetch(`https://repo.maven.apache.org/maven2/org/jacoco/${artifact}`);
    if (!response.ok) throw new Error(`Cannot download ${filename}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== checksum) throw new Error(`Checksum mismatch: ${filename}`);
    await writeFile(target, bytes);
  }
  console.log(`Ready: ${filename} (JaCoCo 0.8.14)`);
}
