import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'linux-images.js'), 'utf8');
const ctx = {};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);
const L = ctx.LinuxImages;

const ALLOWED = ['dl-cdn.alpinelinux.org', 'cdimage.ubuntu.com'];

test('catalog has the built-in image first and unique ids', () => {
    assert.equal(L.CATALOG[0].id, 'builtin');
    const ids = L.CATALOG.map(i => i.id);
    assert.equal(new Set(ids).size, ids.length);
});

test('every downloadable image uses https from an allowed host and has a checksum address', () => {
    for (const img of L.CATALOG.filter(i => !i.builtin && i.supported)) {
        const u = new URL(img.tarballUrl);
        const c = new URL(img.checksumUrl);
        assert.equal(u.protocol, 'https:', img.id);
        assert.equal(c.protocol, 'https:', img.id);
        assert.ok(ALLOWED.includes(u.host), img.id + ' tarball host');
        assert.ok(ALLOWED.includes(c.host), img.id + ' checksum host');
        assert.ok(img.tarballUrl.endsWith('-arm64.tar.gz') || img.tarballUrl.endsWith('-aarch64.tar.gz'), img.id);
    }
});

test('Alpine images use a one-hash sidecar; Ubuntu images use a listed SHA256SUMS', () => {
    for (const img of L.CATALOG.filter(i => i.distro === 'alpine' && !i.builtin)) {
        assert.equal(img.checksumUrl, img.tarballUrl + '.sha256', img.id);
        assert.equal(img.checksumListed, false, img.id);
        assert.equal(img.apkBranch, 'v' + img.id.replace('alpine-', ''), img.id);
    }
    for (const img of L.CATALOG.filter(i => i.distro === 'ubuntu')) {
        assert.ok(img.checksumUrl.endsWith('/SHA256SUMS'), img.id);
        assert.equal(img.checksumListed, true, img.id);
        assert.equal(img.apkBranch, '', 'Ubuntu has no apk');
    }
});

test('Debian is listed but disabled until xz support exists', () => {
    const deb = L.CATALOG.filter(i => i.distro === 'debian');
    assert.ok(deb.length >= 1);
    for (const img of deb) {
        assert.equal(img.supported, false);
        assert.throws(() => L.installArgs(img), /Needs .tar.xz/);
    }
});

test('installArgs: built-in takes only its id; others carry the download addresses', () => {
    // JSON round-trip: the object comes from another realm (vm context), so compare plain data.
    assert.deepEqual(JSON.parse(JSON.stringify(L.installArgs(L.find('builtin')))), { id: 'builtin' });
    const a = L.installArgs(L.find('alpine-3.21'));
    assert.equal(a.id, 'alpine-3.21');
    assert.equal(a.checksumListed, false);
    assert.equal(a.apkBranch, 'v3.21');
    const u = L.installArgs(L.find('ubuntu-22.04'));
    assert.equal(u.checksumListed, true);
    assert.equal(u.apkBranch, '');
});

test('find returns null for unknown ids and installArgs rejects missing images', () => {
    assert.equal(L.find('nope'), null);
    assert.throws(() => L.installArgs(null), /Unknown image/);
});
