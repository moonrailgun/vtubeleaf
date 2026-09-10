import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    app: { type: 'string' },
    identity: { type: 'string' },
    'team-id': { type: 'string' },
    'host-profile': { type: 'string' },
    'extension-profile': { type: 'string' },
    arch: { type: 'string' },
    test: { type: 'boolean' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(`Unsigned build: node scripts/build-camera.mjs [--arch arm64|x86_64|universal] [--test]
Signed packaging (after Tauri build; does not install):
  node scripts/build-camera.mjs --app /path/VTubeLeaf.app --team-id TEAMID1234 --identity 'Developer ID Application: ...' --host-profile /path/host.provisionprofile --extension-profile /path/camera.provisionprofile
Signing uses only the explicitly supplied identity and profiles. No activation or notarization is performed.`);
  process.exit(0);
}
const profileAllowsAppGroup = (groups, team) =>
  Array.isArray(groups) &&
  (groups.includes(`${team}.com.vtubeleaf.camera`) || groups.includes(`${team}.*`));
if (values.test) {
  for (const [groups, allowed] of [
    [['TEAMID1234.com.vtubeleaf.camera'], true],
    [['TEAMID1234.*'], true],
    [['OTHER12345.*'], false],
    [['TEAMID1234.com.other'], false],
    [['*'], false],
    [[], false],
    [undefined, false],
    ['TEAMID1234.com.vtubeleaf.camera', false],
  ]) {
    assert.equal(profileAllowsAppGroup(groups, 'TEAMID1234'), allowed, JSON.stringify(groups));
  }
  console.log('Profile app group checks passed.');
}
if (process.platform !== 'darwin')
  throw new Error('Camera Extension builds require macOS and Xcode.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const native = join(root, 'native/macos-camera');
const build = join(native, 'build');
mkdirSync(build, { recursive: true });
const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: ['pipe', 'pipe', 'inherit'], ...options });
const readPlist = (path) =>
  JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', path]).toString());
const writePlist = (path, data) => {
  writeFileSync(path, JSON.stringify(data));
  run('plutil', ['-convert', 'xml1', path]);
};
const team = values['team-id'] ?? 'UNSIGNED';
const appGroup = `${team}.com.vtubeleaf.camera`;
if (team !== 'UNSIGNED' && !/^[A-Z0-9]{10}$/.test(team))
  throw new Error('--team-id must be a 10-character Apple Team ID.');
const app = values.app && resolve(values.app);
if (!app && (values.identity || values['host-profile'] || values['extension-profile']))
  throw new Error('Signing arguments require --app.');
let appInfo;
let hostProfile;
let extensionProfile;
if (app) {
  if (
    !values.identity ||
    values.identity === '-' ||
    team === 'UNSIGNED' ||
    !values['host-profile'] ||
    !values['extension-profile']
  ) {
    throw new Error(
      'Signed packaging requires --identity, --team-id, --host-profile and --extension-profile.',
    );
  }
  appInfo = readPlist(join(app, 'Contents/Info.plist'));
  if (appInfo.CFBundleIdentifier !== 'com.moonrailgun.vtubeleaf')
    throw new Error('The app bundle ID must be com.moonrailgun.vtubeleaf.');
  const profile = (path, identifier, host) => {
    const xml = run('security', ['cms', '-D', '-i', resolve(path)]);
    // Profiles contain date/data values that plutil cannot convert to JSON. Decode only
    // the needed fields with Python's standard plist parser supplied by Xcode.
    const data = JSON.parse(
      run(
        'xcrun',
        [
          'python3',
          '-c',
          'import sys,plistlib,json; p=plistlib.loads(sys.stdin.buffer.read()); print(json.dumps({"TeamIdentifier":p.get("TeamIdentifier",[]),"ExpirationDate":p["ExpirationDate"].isoformat()+"Z","Entitlements":p.get("Entitlements",{})}))',
        ],
        { input: xml },
      ).toString(),
    );
    const entitlements = data.Entitlements ?? {};
    const appID =
      entitlements['com.apple.application-identifier'] ?? entitlements['application-identifier'];
    if (
      !data.TeamIdentifier?.includes(team) ||
      appID !== `${team}.${identifier}` ||
      new Date(data.ExpirationDate) <= new Date()
    ) {
      throw new Error(`Profile does not match ${team}.${identifier}, or has expired.`);
    }
    if (!profileAllowsAppGroup(entitlements['com.apple.security.application-groups'], team)) {
      throw new Error(
        `Both provisioning profiles must authorize ${team}.com.vtubeleaf.camera or ${team}.*.`,
      );
    }
    if (host && entitlements['com.apple.developer.system-extension.install'] !== true)
      throw new Error('Host profile must allow system-extension.install.');
    return { path: resolve(path), entitlements };
  };
  hostProfile = profile(values['host-profile'], 'com.moonrailgun.vtubeleaf', true);
  extensionProfile = profile(
    values['extension-profile'],
    'com.moonrailgun.vtubeleaf.camera',
    false,
  );
}
let arch = values.arch ?? (process.arch === 'arm64' ? 'arm64' : 'x86_64');
if (app) {
  const appArchitectures = run('lipo', [
    '-archs',
    join(app, 'Contents/MacOS', appInfo.CFBundleExecutable),
  ])
    .toString()
    .trim()
    .split(/\s+/);
  arch = appArchitectures.length > 1 ? 'universal' : appArchitectures[0];
  if (values.arch && values.arch !== arch) throw new Error('--arch must match the app executable.');
}
if (!['arm64', 'x86_64', 'universal'].includes(arch)) throw new Error('Unsupported --arch.');
const architectures = arch === 'universal' ? ['arm64', 'x86_64'] : [arch];
const extension = join(build, 'com.moonrailgun.vtubeleaf.camera.systemextension');
rmSync(extension, { recursive: true, force: true });
mkdirSync(join(extension, 'Contents/MacOS'), { recursive: true });
const info = readPlist(join(native, 'Info.plist'));
// CoreMediaIO requires the Mach service name to start with an entitled App Group.
info.CMIOExtension.CMIOExtensionMachServiceName = appGroup;
info.CameraTeamIdentifier = team;
if (appInfo) {
  info.CFBundleShortVersionString = appInfo.CFBundleShortVersionString;
  info.CFBundleVersion = appInfo.CFBundleVersion;
}
writePlist(join(extension, 'Contents/Info.plist'), info);
for (const cpu of architectures) {
  run('xcrun', [
    'swiftc',
    '-swift-version',
    '5',
    '-O',
    '-target',
    `${cpu}-apple-macos14.0`,
    join(native, 'Frame.swift'),
    join(native, 'Extension.swift'),
    join(native, 'main.swift'),
    '-o',
    join(build, `camera-${cpu}`),
  ]);
}
const executable = join(extension, 'Contents/MacOS/VTubeLeafCamera');
if (architectures.length === 2)
  run('lipo', [
    '-create',
    ...architectures.map((cpu) => join(build, `camera-${cpu}`)),
    '-output',
    executable,
  ]);
else cpSync(join(build, `camera-${arch}`), executable);
if (values.test) {
  const builtInfo = readPlist(join(extension, 'Contents/Info.plist'));
  assert.ok(
    builtInfo.CMIOExtension.CMIOExtensionMachServiceName.startsWith(appGroup),
    'Camera Mach service name must be prefixed with the signed App Group.',
  );
  console.log('Camera Mach service App Group check passed.');
  run('xcrun', [
    'swiftc',
    '-swift-version',
    '5',
    '-target',
    `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos14.0`,
    join(native, 'Frame.swift'),
    join(native, 'tests/Frames.swift'),
    '-o',
    join(build, 'frame-checks'),
  ]);
  console.log(run(join(build, 'frame-checks'), []).toString().trim());
  run('xcrun', [
    'swiftc',
    '-swift-version',
    '5',
    '-target',
    `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos14.0`,
    join(native, 'Frame.swift'),
    join(native, 'Host.swift'),
    join(native, 'tests/HostChecks.swift'),
    '-o',
    join(build, 'host-checks'),
  ]);
  console.log(run(join(build, 'host-checks'), []).toString().trim());
}
if (app) {
  // Preserve existing host entitlements, including those added by Tauri or the distributor.
  let existing = {};
  try {
    const xml = run('codesign', ['-d', '--entitlements', ':-', app], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (xml.length)
      existing = JSON.parse(
        run('plutil', ['-convert', 'json', '-o', '-', '--', '-'], { input: xml }).toString(),
      );
  } catch (error) {
    // Unsigned Tauri builds have no entitlement blob. A signed app with unreadable entitlements must not be overwritten.
    let signed = false;
    try {
      run('codesign', ['-d', app], { stdio: 'pipe' });
      signed = true;
    } catch {
      existing = {};
    }
    if (signed) throw error;
  }
  const shared = { 'com.apple.security.application-groups': [appGroup] };
  const config = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  const hostEntitlements = {
    ...existing,
    ...hostProfile.entitlements,
    // Release builds are unsigned until this step, so also load Tauri's host permissions.
    ...readPlist(join(root, 'src-tauri', config.bundle.macOS.entitlements)),
    ...shared,
    'com.apple.developer.system-extension.install': true,
  };
  const cameraEntitlements = {
    ...extensionProfile.entitlements,
    ...shared,
    'com.apple.security.app-sandbox': true,
  };
  const hostFile = join(build, 'Host.entitlements');
  const cameraFile = join(build, 'Camera.entitlements');
  writePlist(hostFile, hostEntitlements);
  writePlist(cameraFile, cameraEntitlements);
  cpSync(extensionProfile.path, join(extension, 'Contents/embedded.provisionprofile'));
  run('codesign', [
    '--force',
    '--options',
    'runtime',
    '--timestamp',
    '--sign',
    values.identity,
    '--entitlements',
    cameraFile,
    extension,
  ]);
  const destination = join(
    app,
    'Contents/Library/SystemExtensions',
    'com.moonrailgun.vtubeleaf.camera.systemextension',
  );
  // Copying into an existing bundle must not leave a stale signature or executable from a previous version.
  if (existsSync(destination))
    throw new Error(`Extension already exists: ${destination}. Package a fresh Tauri build.`);
  cpSync(extension, destination, { recursive: true });
  cpSync(hostProfile.path, join(app, 'Contents/embedded.provisionprofile'));
  appInfo.NSSystemExtensionUsageDescription = info.NSSystemExtensionUsageDescription;
  writePlist(join(app, 'Contents/Info.plist'), appInfo);
  run('codesign', [
    '--force',
    '--options',
    'runtime',
    '--timestamp',
    '--sign',
    values.identity,
    '--entitlements',
    hostFile,
    app,
  ]);
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  if (values.test) {
    const xml = run('codesign', ['-d', '--entitlements', ':-', app]);
    const signed = JSON.parse(
      run('plutil', ['-convert', 'json', '-o', '-', '--', '-'], { input: xml }).toString(),
    );
    assert.equal(signed['com.apple.security.device.camera'], true);
    assert.equal(signed['com.apple.security.device.audio-input'], true);
    console.log('Signed camera and microphone permission checks passed.');
  }
  console.log(
    `Signed camera package: ${app}\nNot installed or activated. Notarize and staple this final app before distribution.`,
  );
} else {
  console.log(
    `Unsigned camera extension compiled (${arch}): ${extension}\nCompilation only; not installable. Use --help for explicit signed packaging.`,
  );
}
