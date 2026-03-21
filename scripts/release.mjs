import { spawnSync } from 'node:child_process';

const rawTarget = String(process.argv[2] || 'patch').trim();
const target = rawTarget || 'patch';
const validBumps = new Set(['patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease']);
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

if (!validBumps.has(target) && !semverPattern.test(target)) {
  console.error(
    'Invalid release target. Use one of: patch, minor, major, prepatch, preminor, premajor, prerelease, or an explicit semver like 1.4.0'
  );
  process.exit(1);
}

const buildLabel = String(process.env.VITE_APP_BUILD_LABEL || 'production').trim() || 'production';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log(`Releasing with target "${target}"...`);
run('npm', ['version', target, '--no-git-tag-version']);
console.log(`Building app with build label "${buildLabel}"...`);
run('npm', ['run', 'build:web'], {
  env: {
    ...process.env,
    VITE_APP_BUILD_LABEL: buildLabel
  }
});

console.log('Release build complete.');
