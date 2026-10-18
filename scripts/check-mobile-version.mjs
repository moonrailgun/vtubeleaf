import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function checkAndroidVersionCode(code) {
  assert.ok(
    Number.isInteger(code) && code > 0 && code <= 2_100_000_000,
    'Android versionCode must be an integer between 1 and 2100000000',
  );
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = new URL('../mobile/package.json', import.meta.url);
  const mobile = JSON.parse(readFileSync(path, 'utf8'));
  const { version } = mobile;
  const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  assert.match(version, stableVersion, 'Expected a stable mobile version');
  const code = checkAndroidVersionCode(mobile.versionCode);
  if (process.argv[2] === '--ci') {
    assert.equal(
      process.env.GITHUB_REF,
      `refs/tags/mobile-v${version}`,
      'Release requires a tag matching mobile/package.json',
    );
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nversion-code=${code}\n`);
  } else if (process.argv[2] === '--bump-code') {
    mobile.versionCode = checkAndroidVersionCode(code + 1);
    writeFileSync(path, `${JSON.stringify(mobile, null, 2)}\n`);
  } else {
    assert.match(process.argv[2], stableVersion, 'Expected a stable mobile version');
    assert.ok(
      process.argv[2].localeCompare(version, 'en', { numeric: true }) > 0,
      'Mobile release version must increase',
    );
    checkAndroidVersionCode(code + 1);
  }
}
