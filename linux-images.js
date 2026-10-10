/*
 * Container images for the Linux terminal: the catalog, and the arguments the native
 * plugin needs to install each one.
 *
 * The list of distributions and versions follows AiCode's container-images.json
 * (GPL-3.0, see THIRD_PARTY_NOTICES.md). Descriptions here are written for this project.
 * Only arm64 downloads are listed, because the app runs on phones.
 *
 * Checksums: the native installer refuses an image whose checksum it cannot read.
 * Alpine publishes a .sha256 file next to each tarball. Ubuntu publishes SHA256SUMS in
 * each release directory. Debian's rootfs is .tar.xz, which the installer reads. Debian
 * stays disabled until a checksum source for its download host is verified.
 */
(function (g) {
    'use strict';

    const BUILTIN = {
        id: 'builtin',
        name: 'Alpine Linux',
        version: '3.23.3',
        description: 'Built in. Installed with the app. Uses apk.',
        distro: 'alpine',
        sizeMB: 4,
        builtin: true,
        supported: true,
    };

    function alpine(series, version, description) {
        const tarball = `https://dl-cdn.alpinelinux.org/alpine/v${series}/releases/aarch64/alpine-minirootfs-${version}-aarch64.tar.gz`;
        return {
            id: 'alpine-' + series,
            name: 'Alpine Linux',
            version,
            description,
            distro: 'alpine',
            sizeMB: 4,
            supported: true,
            tarballUrl: tarball,
            checksumUrl: tarball + '.sha256',
            checksumListed: false,
            apkBranch: 'v' + series,
        };
    }

    function ubuntu(series, version, description) {
        const dir = `https://cdimage.ubuntu.com/ubuntu-base/releases/${series}/release/`;
        return {
            id: 'ubuntu-' + series,
            name: 'Ubuntu',
            version,
            description,
            distro: 'ubuntu',
            sizeMB: 27,
            supported: true,
            tarballUrl: dir + `ubuntu-base-${version}-base-arm64.tar.gz`,
            checksumUrl: dir + 'SHA256SUMS',
            checksumListed: true,
            apkBranch: '',
        };
    }

    function debian(version, description) {
        return {
            id: 'debian-' + version.split(' ')[0],
            name: 'Debian',
            version,
            description,
            distro: 'debian',
            sizeMB: 29,
            supported: false,
            unsupportedReason: 'Checksum source not verified yet.',
        };
    }

    const CATALOG = [
        BUILTIN,
        alpine('3.21', '3.21.7', 'Minimal Linux, a few MB. Uses apk. Same branch as the built-in image.'),
        alpine('3.22', '3.22.5', 'Minimal Linux, a few MB. Uses apk. Small and quick to unpack.'),
        alpine('3.23', '3.23.5', 'Minimal Linux, a few MB. Uses apk. Small and quick to unpack.'),
        alpine('3.24', '3.24.1', 'Minimal Linux, a few MB. Uses apk. Current stable release.'),
        ubuntu('20.04', '20.04.5', 'Ubuntu 20.04 LTS (Focal) base system. Uses apt, not apk.'),
        ubuntu('22.04', '22.04.5', 'Ubuntu 22.04 LTS (Jammy) base system. Uses apt, not apk.'),
        ubuntu('24.04', '24.04.4', 'Ubuntu 24.04 LTS (Noble) base system. Uses apt, not apk.'),
        debian('12 (bookworm)', 'Debian 12 stable base system. Uses apt.'),
        debian('13 (trixie)', 'Debian 13 current stable base system. Uses apt.'),
    ];

    function find(id) {
        return CATALOG.find(img => img.id === id) || null;
    }

    /** Arguments for LinuxShell.install({...}). The built-in image takes only its id. */
    function installArgs(image) {
        if (!image) throw new Error('Unknown image');
        if (image.builtin) return { id: 'builtin' };
        if (!image.supported) throw new Error(image.unsupportedReason || 'This image is not supported yet.');
        return {
            id: image.id,
            distro: image.distro,
            tarballUrl: image.tarballUrl,
            checksumUrl: image.checksumUrl,
            checksumListed: !!image.checksumListed,
            apkBranch: image.apkBranch || '',
        };
    }

    g.LinuxImages = { CATALOG, find, installArgs };
})(typeof window !== 'undefined' ? window : globalThis);
