import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import { authorizeDeployment } from '../src/deploy-receiver.js';

test('deployment accepts only fresh signed main-branch identities from the exact GitHub workflow', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey); jwk.kid = 'test';
  const keys = createLocalJWKSet({ keys: [jwk] });
  const claims = { repository: 'vrpottot/JavaBlueprint', repository_owner: 'vrpottot', ref: 'refs/heads/main', workflow_ref: 'vrpottot/JavaBlueprint/.github/workflows/check.yml@refs/heads/main', event_name: 'push', sha: 'a'.repeat(40), run_number: '42' };
  const sign = (changes = {}, expiry = '2m') => new SignJWT({ ...claims, ...changes }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer('https://token.actions.githubusercontent.com').setAudience('javascope-deploy').setSubject('repo:test').setJti('test-jti').setIssuedAt().setExpirationTime(expiry).sign(privateKey);
  assert.equal((await authorizeDeployment(await sign(), keys)).sha, claims.sha);
  for (const changes of [{ ref: 'refs/heads/other' }, { repository: 'attacker/JavaBlueprint' }, { event_name: 'pull_request' }, { workflow_ref: 'vrpottot/JavaBlueprint/.github/workflows/other.yml@refs/heads/main' }, { sha: '../invalid' }]) {
    await assert.rejects(authorizeDeployment(await sign(changes), keys));
  }
  await assert.rejects(authorizeDeployment(await sign({}, '-1m'), keys));
  const other = await generateKeyPair('RS256');
  const wrong = createLocalJWKSet({ keys: [{ ...await exportJWK(other.publicKey), kid: 'test' }] });
  await assert.rejects(authorizeDeployment(await sign(), wrong));
});
