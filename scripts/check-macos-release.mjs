import assert from 'node:assert/strict';

const required = [
  'MACOS_CERTIFICATE_P12_BASE64',
  'MACOS_CERTIFICATE_PASSWORD',
  'MACOS_HOST_PROFILE_BASE64',
  'MACOS_CAMERA_PROFILE_BASE64',
  'APPLE_API_KEY_P8_BASE64',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'APPLE_TEAM_ID',
  'APPLE_SIGNING_IDENTITY',
];

function check(env) {
  for (const name of required) assert.ok(env[name]?.trim(), `Missing ${name}`);
  assert.match(env.APPLE_TEAM_ID, /^[A-Z0-9]{10}$/, 'Invalid APPLE_TEAM_ID');
  assert.ok(
    env.APPLE_SIGNING_IDENTITY.startsWith('Developer ID Application: ') &&
      env.APPLE_SIGNING_IDENTITY.endsWith(` (${env.APPLE_TEAM_ID})`),
    'APPLE_SIGNING_IDENTITY must be a Developer ID Application identity for APPLE_TEAM_ID',
  );
  assert.match(env.APPLE_API_KEY_ID, /^[A-Z0-9]{10}$/, 'Invalid APPLE_API_KEY_ID');
  assert.match(
    env.APPLE_API_ISSUER,
    /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i,
    'Invalid APPLE_API_ISSUER; use an App Store Connect team API key',
  );
}

if (process.argv.includes('--self-test')) {
  const valid = {
    ...Object.fromEntries(required.map((name) => [name, 'test'])),
    APPLE_TEAM_ID: 'TEAMID1234',
    APPLE_SIGNING_IDENTITY: 'Developer ID Application: Example (TEAMID1234)',
    APPLE_API_KEY_ID: 'ABC1234567',
    APPLE_API_ISSUER: '01234567-89ab-cdef-0123-456789abcdef',
  };
  check(valid);
  for (const name of required) assert.throws(() => check({ ...valid, [name]: '' }));
  for (const [name, value] of [
    ['APPLE_SIGNING_IDENTITY', '-'],
    ['APPLE_SIGNING_IDENTITY', 'Developer ID Application: Example (OTHER12345)'],
    ['APPLE_TEAM_ID', 'invalid'],
    ['APPLE_API_KEY_ID', 'invalid'],
    ['APPLE_API_ISSUER', 'individual-key'],
  ]) {
    assert.throws(() => check({ ...valid, [name]: value }));
  }
  console.log('macOS release configuration self-check passed.');
} else {
  try {
    check(process.env);
    console.log('Required macOS release configuration is present.');
  } catch (error) {
    // Only report our validation message, never an assertion's actual secret value.
    console.error(error.message.split('\n')[0]);
    process.exitCode = 1;
  }
}
