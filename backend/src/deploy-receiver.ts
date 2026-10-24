import { createServer } from 'node:http';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const issuer = 'https://token.actions.githubusercontent.com';
const githubKeys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`), { timeoutDuration: 5000, cooldownDuration: 30000 });
const repository = 'vrpottot/JavaBlueprint';
export async function authorizeDeployment(token: string, keys: JWTVerifyGetKey = githubKeys) {
  const { payload } = await jwtVerify(token, keys, {
    issuer, audience: 'javascope-deploy', algorithms: ['RS256'], clockTolerance: 15, maxTokenAge: '5m',
    requiredClaims: ['sub', 'exp', 'iat', 'jti', 'repository', 'ref', 'workflow_ref', 'sha', 'event_name'],
  });
  if (payload.repository !== repository || payload.repository_owner !== 'vrpottot'
    || payload.ref !== 'refs/heads/main' || payload.event_name !== 'push'
    || payload.workflow_ref !== `${repository}/.github/workflows/check.yml@refs/heads/main`
    || typeof payload.sha !== 'string' || !/^[0-9a-f]{40}$/.test(payload.sha)
    || typeof payload.run_number !== 'string' || !/^\d{1,12}$/.test(payload.run_number)) throw new Error('Deployment identity is not authorized');
  return { sha: payload.sha, jti: String(payload.jti), runNumber: Number(payload.run_number) };
}

export function startDeployReceiver() {
  const consumed = new Map<string, number>();
  let accepting = false;
  const server = createServer(async (request, response) => {
    const send = (status: number, value: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
    if (request.method !== 'POST' || request.url !== '/_deploy') return send(404, { error: 'Not found' });
    let path: string | undefined, ownsUpload = false;
    try {
      const header = request.headers.authorization || '';
      if (!header.startsWith('Bearer ') || header.length > 12000) return send(401, { error: 'GitHub identity required' });
      let identity;
      try { identity = await authorizeDeployment(header.slice(7)); } catch { return send(403, { error: 'Invalid GitHub deployment identity' }); }
      for (const [jti, time] of consumed) if (Date.now() - time > 360000) consumed.delete(jti);
      if (consumed.has(identity.jti)) return send(409, { error: 'Identity already used' });
      if (accepting) return send(429, { error: 'Deployment upload already in progress' });
      accepting = true; ownsUpload = true;
      try {
        const latest = JSON.parse(await readFile('/opt/javascope/incoming/latest-run.json', 'utf8')) as { runNumber: number };
        if (identity.runNumber < latest.runNumber) return send(409, { error: 'A newer workflow has already been accepted' });
      } catch { /* No prior accepted run. */ }
      try {
        if ((await readFile('/var/lib/javascope/deployed-head', 'utf8')).trim() === identity.sha) {
          console.log(JSON.stringify({ event: 'github-deployment-current', sha: identity.sha }));
          return send(200, { sha: identity.sha, deployed: true });
        }
      } catch { /* First release. */ }
      consumed.set(identity.jti, Date.now());
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const value of request) {
        const chunk = Buffer.from(value); bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) return send(413, { error: 'Archive exceeds 8 MiB' });
        chunks.push(chunk);
      }
      if (bytes < 100) return send(400, { error: 'Empty archive' });
      await mkdir('/opt/javascope/incoming', { recursive: true, mode: 0o700 });
      path = `/opt/javascope/incoming/${identity.sha}-${Date.now()}.tar.gz`;
      await writeFile(path, Buffer.concat(chunks), { mode: 0o600, flag: 'wx' });
      await writeFile('/opt/javascope/incoming/latest-run.json', JSON.stringify({ runNumber: identity.runNumber, sha: identity.sha }), { mode: 0o600 });
      const args = ['--quiet', '--collect', '--no-block', `--unit=javascope-release-${identity.sha.slice(0, 12)}-${Date.now()}`, '--property=Type=oneshot', '--property=TimeoutStartSec=600',
        '/bin/bash', '/opt/javascope/current/deploy/install-bundle.sh', path, identity.sha];
      const code = await new Promise<number>(resolve => {
        const child = spawn('/usr/bin/systemd-run', args, { stdio: 'ignore', shell: false });
        child.on('error', () => resolve(1)); child.on('close', result => resolve(result ?? 1));
      });
      if (code !== 0) throw new Error('Cannot schedule deployment');
      path = undefined; // The privileged installer owns cleanup after scheduling.
      console.log(JSON.stringify({ event: 'github-release-accepted', sha: identity.sha }));
      return send(202, { sha: identity.sha, accepted: true });
    } catch { return send(500, { error: 'Deployment could not be scheduled' }); }
    finally { if (ownsUpload) accepting = false; if (path) await rm(path, { force: true }).catch(() => {}); }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.listen(3003, '127.0.0.1');
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startDeployReceiver();
