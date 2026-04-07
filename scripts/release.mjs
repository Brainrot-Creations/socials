#!/usr/bin/env node
/**
 * release.mjs — version bump + build + publish for socials-mcp
 *
 * Usage:
 *   node scripts/release.mjs patch          # 1.1.11 → 1.1.12
 *   node scripts/release.mjs minor          # 1.1.11 → 1.2.0
 *   node scripts/release.mjs major          # 1.1.11 → 2.0.0
 *   node scripts/release.mjs 1.2.3          # explicit version
 *   node scripts/release.mjs patch --dry-run
 *   node scripts/release.mjs patch --otp=123456
 *   node scripts/release.mjs patch --skip-gh-release
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const run = (cmd, opts = {}) => {
  console.log(`  $ ${cmd}`);
  return execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts });
};

const runOutput = (cmd, opts = {}) =>
  execSync(cmd, { cwd: ROOT, encoding: 'utf8', ...opts }).trim();

function readPkg() {
  const path = resolve(ROOT, 'package.json');
  return { path, json: JSON.parse(readFileSync(path, 'utf8')) };
}

function bumpVersion(current, bump) {
  const [major, minor, patch] = current.split('.').map(Number);
  switch (bump) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
    default:      return bump;
  }
}

const [,, bumpArg, ...flags] = process.argv;
const DRY_RUN        = flags.includes('--dry-run');
const SKIP_GIT_CHECK = flags.includes('--skip-git-check');
const SKIP_PUBLISH   = flags.includes('--skip-publish');
const otpFlag        = flags.find(f => f.startsWith('--otp='));
const OTP            = otpFlag ? otpFlag.split('=')[1] : '';

if (!bumpArg || !['patch', 'minor', 'major'].includes(bumpArg) && !/^\d/.test(bumpArg)) {
  console.error('Usage: node scripts/release.mjs <patch|minor|major|x.y.z> [--dry-run]');
  process.exit(1);
}

const { path: pkgPath, json: pkg } = readPkg();
const currentVer = pkg.version;
const nextVer    = bumpVersion(currentVer, bumpArg);

console.log(`\n▶  socials-mcp  ${currentVer} → ${nextVer}${DRY_RUN ? '  (dry run)' : ''}\n`);

const gitStatus = runOutput('git status --porcelain');
if (gitStatus && !SKIP_GIT_CHECK) {
  console.error('✗  Working tree is dirty. Commit or stash changes first.');
  console.error(gitStatus);
  process.exit(1);
}

console.log('→  Bumping version…');
pkg.version = nextVer;
if (!DRY_RUN) writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// Also bump unscoped package version + dependency
const unscopedPath = resolve(ROOT, 'packages/unscoped/package.json');
const unscopedPkg = JSON.parse(readFileSync(unscopedPath, 'utf8'));
unscopedPkg.version = nextVer;
unscopedPkg.dependencies['@brainrotcreations/socials'] = nextVer;
if (!DRY_RUN) writeFileSync(unscopedPath, JSON.stringify(unscopedPkg, null, 2) + '\n');

console.log('→  Building…');
if (!DRY_RUN) run('npm run build');

console.log('→  Typechecking…');
if (!DRY_RUN) {
  try { run('npm run typecheck'); }
  catch { console.error('✗  Typecheck failed.'); process.exit(1); }
}

const tag = `v${nextVer}`;
console.log(`\n→  Committing and tagging ${tag}…`);
if (!DRY_RUN) {
  run('git add package.json packages/unscoped/package.json');
  const staged = runOutput('git diff --cached --name-only');
  if (staged) run(`git commit -m "chore: release ${tag}"`);
  const tagExists = runOutput(`git tag -l ${tag}`);
  if (!tagExists) run(`git tag ${tag} -m "Release ${tag}"`);
}

if (!SKIP_PUBLISH) {
  console.log('\n→  Publishing to npm…');
  const NPM_TAG = nextVer.includes('-') ? 'next' : 'latest';
  if (!DRY_RUN) {
    const otpArg = OTP ? ` --otp=${OTP}` : '';
    run(`npm publish --access public --tag ${NPM_TAG}${otpArg}`);
    run(`npm install && npm publish --access public --tag ${NPM_TAG}${otpArg}`, {
      cwd: resolve(ROOT, 'packages/unscoped'),
    });
  }
}

console.log('\n→  Pushing to origin…');
if (!DRY_RUN) {
  run('git push');
  const remoteTag = runOutput(`git ls-remote --tags origin refs/tags/${tag}`);
  if (!remoteTag) run(`git push origin ${tag}`);
}

const SKIP_GH_RELEASE = flags.includes('--skip-gh-release') || SKIP_PUBLISH;
const ghAvailable = (() => { try { runOutput('gh --version'); return true; } catch { return false; } })();

if (!SKIP_GH_RELEASE && ghAvailable && !DRY_RUN) {
  console.log(`\n→  Creating GitHub Release ${tag}…`);
  try {
    const prevTag = runOutput('git describe --tags --abbrev=0 HEAD~1 2>/dev/null || echo ""');
    const notes = prevTag
      ? runOutput(`git log ${prevTag}..${tag} --pretty=format:"- %s (%h)" --no-merges`) || `Release ${tag}`
      : `Initial release of ${tag}`;
    const prerelease = nextVer.includes('-') ? ' --prerelease' : '';
    run(`gh release create ${tag} --title "${tag}"${prerelease} --notes ${JSON.stringify(notes)}`);
  } catch { /* non-fatal */ }
}

console.log(`\n✓  Released ${tag}${DRY_RUN ? ' (dry run — nothing published)' : ''}`);
console.log(`   npm: https://www.npmjs.com/package/@brainrotcreations/socials/v/${nextVer}\n`);
