import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

test('déploiement : manifeste nginx-site 1.1 exact et script présent dans le dépôt', () => {
  const manifest = JSON.parse(read('nginx-site.json'));
  assert.deepEqual(manifest, {
    version: 1,
    script: 'deploy/manage.sh',
    hooks: { install: 'root', update: 'root', check: 'project', status: 'project' },
    units: ['filmsvus.service'],
  });
  const script = resolve(root, manifest.script);
  assert.ok(script.startsWith(root.endsWith(sep) ? root : `${root}${sep}`));
  assert.ok(existsSync(script));
  for (const hook of ['install', 'update', 'check']) assert.ok(hook in manifest.hooks);
  for (const role of Object.values(manifest.hooks)) assert.ok(role === 'root' || role === 'project');
  for (const unit of manifest.units) assert.match(unit, /^[a-zA-Z0-9_][a-zA-Z0-9_.@-]*\.(service|timer|mount|target)$/);
});

test('déploiement : version Node épinglée en LF et compatible avec engines.node', () => {
  const versionFile = read('.node-version');
  assert.match(versionFile, /^[0-9]+\.[0-9]+\.[0-9]+\n$/);
  const version = versionFile.trim().split('.').map(Number);
  const { engines } = JSON.parse(read('package.json'));
  const minimum = /^>=(\d+)$/.exec(engines.node);
  assert.ok(minimum, 'Update the constraint check if engines.node gains a more complex range');
  assert.ok(Number(minimum[1]) >= 24);
  assert.ok(version[0]! >= Number(minimum[1]), `${versionFile.trim()} must satisfy ${engines.node}`);
});

test('déploiement : script Bash sans CR', () => {
  const script = read('deploy/manage.sh');
  assert.ok(script.startsWith('#!/usr/bin/env bash\n'));
  assert.ok(!script.includes('\r'));
});

test('déploiement : syntaxe Bash valide quand Bash est disponible', t => {
  const available = spawnSync('bash', ['--version'], { encoding: 'utf8', cwd: root });
  const code = (available.error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM') {
    t.skip(`bash is unavailable in this environment (${code})`);
    return;
  }
  assert.ifError(available.error);
  assert.equal(available.status, 0, available.stderr);
  const result = spawnSync('bash', ['-n', 'deploy/manage.sh'], { encoding: 'utf8', cwd: root });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
