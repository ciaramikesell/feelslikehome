import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePhotoUrl, serializePhotoFrame, photoRequestUrl, photoStoragePath, samePhoto, validatePhotoUrl, photoObjectPosition } from '../src/lib/photoFraming.js';
const backend = 'https://project.supabase.co';
const path = '11111111-1111-4111-8111-111111111111/photo.webp';
const source = `${backend}/storage/v1/object/public/home-photos/${path}`;
const envelope = body => `${source}#flh-photo-frame=${encodeURIComponent(JSON.stringify(body))}`;

test('framing is reversible and preserves every original fragment byte and query', () => {
  for (const fragment of [null, '', 'floor-one', 'xywh=0,0,100,100', 'a%23b&x=1', '屋根 💛', 'trailing ', 'flh-photo-frame=unrelated']) {
    const url = `${source}?download=one%2Ftwo&x=a+b${fragment === null ? '' : `#${fragment}`}`;
    const framed = serializePhotoFrame(url, { x: 12, y: 87 }, backend);
    assert.equal(photoRequestUrl(framed, backend), url);
    assert.equal(serializePhotoFrame(framed, { x: 50, y: 50 }, backend), url);
    assert.equal(samePhoto(url, framed, backend), true);
    assert.equal(validatePhotoUrl(url, backend), url, 'validation preserves legitimate fragment bytes');
    if (!fragment?.startsWith('flh-photo-frame=')) assert.equal(photoObjectPosition(framed, backend), '12% 87%');
    else assert.equal(framed, url, 'namespace collisions are refused, never overwritten');
  }
});

test('repeated adjustments never nest envelopes, duplicate files or change identity/deletion path', () => {
  let framed = `${source}#original`;
  for (let y = 0; y <= 100; y++) {
    framed = serializePhotoFrame(framed, { x: 25, y }, backend);
    assert.equal(photoRequestUrl(framed, backend), `${source}#original`);
    assert.equal(photoStoragePath(framed, backend), path);
    assert.equal(samePhoto(source, framed, backend), true);
  }
});

test('signed, transformed and third-party URLs stay display-only; signatures remain byte-exact', () => {
  for (const url of [
    `${backend}/storage/v1/object/sign/home-photos/${path}?token=a%2Fb+c%3D&download=1#legitimate`,
    `${backend}/storage/v1/render/image/public/home-photos/${path}?width=600`,
    `https://other.example/storage/v1/object/public/home-photos/${path}#original`,
  ]) {
    assert.equal(parsePhotoUrl(url, backend).editable, false);
    assert.equal(serializePhotoFrame(url, { x: 0, y: 100 }, backend), url);
    assert.equal(photoRequestUrl(url, backend), url);
    assert.equal(photoStoragePath(url, backend), null);
    assert.equal(validatePhotoUrl(url, backend), url);
  }
});

test('malformed, unknown-version and invalid positions safely center without silently rewriting stored data', () => {
  for (const position of [{ x: -1, y: 0 }, { x: 101, y: 0 }, { x: '20', y: 0 }, null, { x: 0, y: null }]) {
    const framed = envelope({ version: 1, fragment: 'keep-me', position });
    assert.equal(photoObjectPosition(framed, backend), '50% 50%');
    assert.equal(photoRequestUrl(framed, backend), `${source}#keep-me`);
  }
  const future = envelope({ version: 2, fragment: 'keep-me', position: { x: 0, y: 0 } });
  assert.equal(validatePhotoUrl(future, backend), future, 'ordinary validation cannot strip future metadata');
  assert.equal(photoObjectPosition(future, backend), '50% 50%');
  assert.equal(photoRequestUrl(future, backend), `${source}#keep-me`);
  assert.equal(serializePhotoFrame(future, { x: 10, y: 10 }, backend), future);
  for (const fragment of ['flh-photo-frame=%', 'flh-photo-frame={}', 'flh-photo-frame=null']) {
    const raw = `${source}#${fragment}`;
    assert.equal(photoObjectPosition(raw, backend), '50% 50%');
    assert.equal(photoRequestUrl(raw, backend), raw, 'unrecognized fragments are not silently discarded');
    assert.equal(serializePhotoFrame(raw, { x: 10, y: 10 }, backend), raw);
  }
});

test('validation unwraps metadata before scheme/origin checks; external lookalikes cannot delete storage', () => {
  for (const url of ['javascript:alert(1)', 'data:image/svg+xml,bad', '//other.example/a.jpg', 'https://user:password@project.supabase.co/a.jpg']) {
    assert.equal(validatePhotoUrl(url, backend), undefined);
    assert.equal(photoRequestUrl(url, backend), null);
    assert.equal(photoStoragePath(url, backend), null);
  }
  for (const url of [source.replace('project.supabase.co', 'project.supabase.co.evil.example'), source.replace('/photo.webp', '/..%2Fphoto.webp'), source.replace('https:', 'http:')]) {
    assert.equal(photoStoragePath(url, backend), null);
    assert.equal(parsePhotoUrl(url, backend).editable, false);
  }
  const raw = serializePhotoFrame(`${source}#xywh=1,2,3,4`, { x: 0, y: 100 }, backend);
  assert.equal(validatePhotoUrl(raw, backend), raw);
  assert.equal(photoRequestUrl(raw, backend).includes('flh-photo-frame='), false);
});

 test('cleanup identity treats signed/public/transformed variants as the same object without making them deletable', () => {
  const signed = `${backend}/storage/v1/object/sign/home-photos/${path}?token=a%2Fb+c%3D`;
  const transformed = `${backend}/storage/v1/render/image/public/home-photos/${path}?width=600`;
  const framed = serializePhotoFrame(source, { x: 15, y: 25 }, backend);
  assert.equal(samePhoto(framed, signed, backend), true);
  assert.equal(samePhoto(framed, transformed, backend), true);
  assert.equal(photoStoragePath(signed, backend), null);
  assert.equal(photoStoragePath(transformed, backend), null);
  assert.equal(samePhoto(framed, source.replace('photo.webp', 'other.webp'), backend), false);
});

test('long Unicode/escaped fragments are preserved or refused without emitting unreadable framing', () => {
  for (const fragment of ['屋'.repeat(2000), '%'.repeat(3000), '"'.repeat(2000), 'x'.repeat(7000)]) {
    const raw = `${source}#${fragment}`;
    const framed = serializePhotoFrame(raw, { x: 13, y: 79 }, backend);
    if (parsePhotoUrl(raw, backend).editable) {
      assert.equal(photoRequestUrl(framed, backend), raw);
      assert.equal(photoObjectPosition(framed, backend), '13% 79%');
      assert.equal(serializePhotoFrame(framed, { x: 50, y: 50 }, backend), raw);
    } else assert.equal(framed, raw);
  }
});
