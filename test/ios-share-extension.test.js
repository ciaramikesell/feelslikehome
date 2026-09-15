import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('iOS project embeds one minimal share extension with a derived bundle identifier', () => {
  const project = read('ios/App/App.xcodeproj/project.pbxproj');
  const plist = read('ios/App/ShareExtension/Info.plist');

  assert.match(project, /productType = "com\.apple\.product-type\.app-extension"/);
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = app\.feelslikehome\.mobile\.share/);
  assert.match(project, /ShareExtension\.appex in Embed App Extensions/);
  assert.match(project, /APPLICATION_EXTENSION_API_ONLY = YES/);
  assert.match(plist, /NSExtensionActivationSupportsWebURLWithMaxCount/);
  assert.match(plist, /NSExtensionActivationSupportsWebPageWithMaxCount/);
  assert.match(plist, /NSExtensionActivationSupportsText/);
});

test('share extension hands only a URL to the canonical web intake contract', () => {
  const helper = read('ios/App/ShareExtension/ShareURL.swift');
  const controller = read('ios/App/ShareExtension/ShareViewController.swift');

  assert.match(helper, /https:\/\/feelslikehome\.app\/homes/);
  assert.match(helper, /URLQueryItem\(name: "url", value: sharedURL\.absoluteString\)/);
  assert.match(helper, /scheme == "http" \|\| scheme == "https"/);
  assert.match(controller, /extensionContext\?\.open\(intakeURL\)/);
  assert.match(controller, /Logger\(subsystem: "app\.feelslikehome\.mobile\.share"/);
  assert.doesNotMatch(controller, /logger\.(?:info|error)\([^\n]*(?:sharedURL|intakeURL)/);
  assert.doesNotMatch(controller, /Zillow|Realtor|Apartments\.com|RentCast|Google Places/i);
});

test('share extension has no app group, credentials, or private app-opening bridge', () => {
  const project = read('ios/App/App.xcodeproj/project.pbxproj');
  const sources = `${read('ios/App/ShareExtension/ShareURL.swift')}\n${read('ios/App/ShareExtension/ShareViewController.swift')}`;

  assert.doesNotMatch(project, /com\.apple\.security\.application-groups/);
  assert.doesNotMatch(sources, /Supabase|access[_ ]?token|refresh[_ ]?token|UserDefaults|performSelector|responder/i);
});
