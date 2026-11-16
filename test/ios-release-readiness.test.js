// Milestone 5 (docs/testflight-readiness.md): the iOS release facts the
// TestFlight audit relies on, and the three code-only blockers it fixed
// (placeholder icon, placeholder launch art, missing camera purpose string).
// Signing, team, bundle IDs and entitlements are pinned so nothing changes
// them by accident.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import capacitorConfig from '../capacitor.config.js';

const read = (p) => fs.readFileSync(p, 'utf8');
const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
const appPlist = read('ios/App/App/Info.plist');
const ASSETS = 'ios/App/App/Assets.xcassets';
const ICON = `${ASSETS}/AppIcon.appiconset/AppIcon-512@2x.png`;
const SPLASHES = ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'].map((name) => `${ASSETS}/Splash.imageset/${name}`);

// PNG IHDR: width, height and colour type (2 = RGB, 6 = RGBA, 4 = grey+alpha, 3 = palette).
function png(path) {
  const b = fs.readFileSync(path);
  assert.equal(b.toString('latin1', 12, 16), 'IHDR', path);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25], hasTRNS: b.includes(Buffer.from('tRNS')) };
}
const fromTemplate = (path) => execFileSync('tar', ['-xzOf', 'node_modules/@capacitor/cli/assets/ios-spm-template.tar.gz', path]);

test('signing, team, bundle IDs and versions are exactly as committed (unchanged by this milestone)', () => {
  assert.equal((pbx.match(/DEVELOPMENT_TEAM = QCQYKZVAC8;/g) || []).length, 4, 'App + ShareExtension, Debug + Release');
  assert.equal((pbx.match(/CODE_SIGN_STYLE = Automatic;/g) || []).length, 4);
  assert.equal((pbx.match(/PRODUCT_BUNDLE_IDENTIFIER = app\.feelslikehome\.mobile;/g) || []).length, 2);
  assert.equal((pbx.match(/PRODUCT_BUNDLE_IDENTIFIER = app\.feelslikehome\.mobile\.share;/g) || []).length, 2);
  // App and extension must carry the same version and build or App Store Connect rejects the upload.
  assert.deepEqual([...new Set(pbx.match(/MARKETING_VERSION = [^;]+;/g))], ['MARKETING_VERSION = 1.0;']);
  assert.deepEqual([...new Set(pbx.match(/CURRENT_PROJECT_VERSION = [^;]+;/g))], ['CURRENT_PROJECT_VERSION = 1;']);
  assert.deepEqual([...new Set(pbx.match(/IPHONEOS_DEPLOYMENT_TARGET = [^;]+;/g))], ['IPHONEOS_DEPLOYMENT_TARGET = 15.0;']);
  assert.equal(capacitorConfig.appId, 'app.feelslikehome.mobile');
});

test('Universal Links and the Share Extension are intact; no new capabilities', () => {
  const entitlements = read('ios/App/App/App.entitlements');
  assert.match(entitlements, /<key>com\.apple\.developer\.associated-domains<\/key>\s*<array>\s*<string>applinks:feelslikehome\.app<\/string>\s*<\/array>/);
  assert.doesNotMatch(entitlements, /application-groups|in-app-payments|aps-environment/);
  assert.doesNotMatch(pbx, /ShareExtension\.entitlements/, 'the extension still has no entitlements');
  assert.match(read('ios/App/ShareExtension/Info.plist'), /<string>com\.apple\.share-services<\/string>/);
  // The AASA route serves the same team + bundle the project signs with.
  assert.match(read('src/lib/aasa.js'), /const BUNDLE_ID = 'app\.feelslikehome\.mobile';/);
});

test('the app loads Production over HTTPS (no Preview or dev URL baked into the release config)', () => {
  assert.equal(capacitorConfig.server.url, 'https://feelslikehome.app');
  assert.equal(capacitorConfig.server.cleartext, false);
});

test('app icon: 1024×1024, opaque (no alpha), and no longer the Capacitor placeholder', () => {
  const icon = png(ICON);
  assert.deepEqual([icon.width, icon.height], [1024, 1024]);
  assert.equal(icon.colorType, 2, 'RGB: App Store Connect rejects an icon with an alpha channel');
  assert.equal(icon.hasTRNS, false);
  assert.notDeepEqual(fs.readFileSync(ICON), fromTemplate('App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'));
  assert.match(read(`${ASSETS}/AppIcon.appiconset/Contents.json`), /"size" : "1024x1024"/);
});

test('launch art: three 2732×2732 opaque images, no longer the Capacitor placeholder', () => {
  for (const path of SPLASHES) {
    const image = png(path);
    assert.deepEqual([image.width, image.height, image.colorType], [2732, 2732, 2], path);
    assert.notDeepEqual(fs.readFileSync(path), fromTemplate(`App/App/Assets.xcassets/Splash.imageset/${path.split('/').pop()}`), path);
  }
  assert.match(read('ios/App/App/Base.lproj/LaunchScreen.storyboard'), /image="Splash"/);
});

test('the camera purpose string exists: the web photo pickers can offer "Take Photo" inside the app', () => {
  for (const path of ['src/components/HomeModal.jsx', 'src/components/HomeFacts.jsx']) assert.match(read(path), /type="file" accept="image\//, path);
  assert.match(appPlist, /<key>NSCameraUsageDescription<\/key>\s*<string>Feels Like Home uses your camera only when you choose to take a photo of a home to save with it\.<\/string>/);
  // Only what the app actually uses: no location, microphone, contacts or tracking prompts.
  assert.doesNotMatch(appPlist, /NSLocation|NSMicrophone|NSContacts|NSUserTracking|NSPhotoLibraryAddUsageDescription/);
});

test('privacy: no tracking or analytics vendor, so no ATT prompt or tracking domains are needed', () => {
  const analytics = read('src/lib/analytics.js');
  assert.match(analytics, /FLH has no analytics vendor and this file deliberately adds none\./);
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual(Object.keys(pkg.dependencies).filter((name) => /analytics|segment|mixpanel|posthog|amplitude|firebase|sentry/i.test(name)), []);
});
