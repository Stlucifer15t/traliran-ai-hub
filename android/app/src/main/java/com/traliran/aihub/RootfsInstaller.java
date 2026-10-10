package com.traliran.aihub;

import android.system.ErrnoException;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;
import java.io.BufferedInputStream;
import java.io.EOFException;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

import org.tukaani.xz.XZInputStream;

/**
 * Installs the Alpine minirootfs (arm64) that the Linux shell runs in.
 *
 * Steps: fetch the checksum file next to the tarball, download the tarball if needed,
 * verify its SHA-256, extract it into linux/rootfs.partial, write DNS and apk settings,
 * then move it to linux/rootfs. Only HTTPS is used.
 *
 * The tar reader handles ustar, GNU long names and pax headers, and creates
 * directories, regular files, symlinks and hard links. Device nodes and other
 * special entries are skipped. Paths that escape the root are rejected.
 *
 * Several images are supported. The image list follows AiCode's container image manager
 * (GPL-3.0, see THIRD_PARTY_NOTICES.md).
 */
final class RootfsInstaller {

    interface Progress {
        void update(String stage, int percent);
    }

    /** The image that ships with the app: Alpine 3.23.3 aarch64, installed at linux/rootfs. */
    static final String BUILTIN_ID = "builtin";
    static final String ALPINE_BRANCH = "v3.23";
    static final String VERSION = "3.23.3";
    static final String BASE_URL = "https://dl-cdn.alpinelinux.org/alpine/" + ALPINE_BRANCH + "/releases/aarch64/";
    static final String TARBALL = "alpine-minirootfs-" + VERSION + "-aarch64.tar.gz";

    /** Hosts an image may be downloaded from. Anything else is refused. */
    static final List<String> ALLOWED_HOSTS = Arrays.asList(
            "dl-cdn.alpinelinux.org", "cdimage.ubuntu.com", "doi-janky.infosiftr.net");
    private static final Pattern IMAGE_ID = Pattern.compile("[a-z0-9][a-z0-9.-]{0,39}");

    /**
     * One downloadable root filesystem. checksumListed is true when checksumUrl is a
     * "hash  filename" list (Ubuntu SHA256SUMS) and false when it is a one-hash file (Alpine .sha256).
     * apkBranch is empty for images without apk (Ubuntu).
     */
    static final class Source {
        final String id;
        final String distro;
        final String tarballUrl;
        final String checksumUrl;
        final boolean checksumListed;
        final String apkBranch;

        Source(String id, String distro, String tarballUrl, String checksumUrl, boolean checksumListed, String apkBranch) {
            this.id = id;
            this.distro = distro;
            this.tarballUrl = tarballUrl;
            this.checksumUrl = checksumUrl;
            this.checksumListed = checksumListed;
            this.apkBranch = apkBranch;
        }

        String fileName() {
            return tarballUrl.substring(tarballUrl.lastIndexOf('/') + 1);
        }
    }

    static Source builtinSource() {
        return new Source(BUILTIN_ID, "alpine", BASE_URL + TARBALL, BASE_URL + TARBALL + ".sha256", false, ALPINE_BRANCH);
    }

    private final File linuxDir;
    private final String imageId;

    RootfsInstaller(File filesDir, String imageId) {
        this.linuxDir = linuxDirOf(filesDir);
        this.imageId = imageId == null ? BUILTIN_ID : imageId;
    }

    static File linuxDirOf(File filesDir) {
        return new File(filesDir, "linux");
    }

    static boolean validId(String id) {
        return id != null && (BUILTIN_ID.equals(id) || IMAGE_ID.matcher(id).matches());
    }

    /** Id of the image Linux runs in. Defaults to the built-in image. */
    static String activeId(File linuxDir) {
        File f = new File(linuxDir, "active");
        if (!f.isFile()) return BUILTIN_ID;
        try (InputStream in = new FileInputStream(f)) {
            String id = new String(readAll(in), StandardCharsets.US_ASCII).trim();
            return validId(id) ? id : BUILTIN_ID;
        } catch (IOException e) {
            return BUILTIN_ID;
        }
    }

    static void setActive(File linuxDir, String id) throws IOException {
        if (!validId(id)) throw new IOException("Unknown image id");
        //noinspection ResultOfMethodCallIgnored
        linuxDir.mkdirs();
        writeText(new File(linuxDir, "active"), id);
    }

    /** Ids of every image whose root filesystem is in place. */
    static List<String> installedIds(File linuxDir) {
        List<String> ids = new ArrayList<>();
        if (rootfsReady(new File(linuxDir, "rootfs"))) ids.add(BUILTIN_ID);
        File[] dirs = new File(linuxDir, "images").listFiles();
        if (dirs != null) {
            for (File d : dirs) {
                if (d.isDirectory() && IMAGE_ID.matcher(d.getName()).matches() && rootfsReady(new File(d, "rootfs"))) {
                    ids.add(d.getName());
                }
            }
        }
        return ids;
    }

    static void deleteImage(File linuxDir, String id) throws IOException {
        if (!IMAGE_ID.matcher(id).matches() || BUILTIN_ID.equals(id)) throw new IOException("This image cannot be deleted");
        deleteRecursively(new File(new File(linuxDir, "images"), id));
    }

    /** True when the root filesystem has a shell or an os-release. Both are checked as regular files. */
    static boolean rootfsReady(File root) {
        return new File(root, "etc/os-release").isFile() || new File(root, "bin/busybox").isFile();
    }

    private File imageDir() {
        return BUILTIN_ID.equals(imageId) ? linuxDir : new File(new File(linuxDir, "images"), imageId);
    }

    File rootfsDir() {
        return new File(imageDir(), "rootfs");
    }

    /**
     * bin/sh is a symlink to /bin/busybox with an absolute target. File.exists() follows that
     * link on the phone's own filesystem, where /bin/busybox does not exist, so check the
     * regular files instead.
     */
    boolean isInstalled() {
        return rootfsReady(rootfsDir());
    }

    static void checkHost(String url) throws IOException {
        URL u = new URL(url);
        if (!"https".equals(u.getProtocol()) || !ALLOWED_HOSTS.contains(u.getHost())) {
            throw new IOException("Download host not allowed: " + u.getHost());
        }
    }

    /** Opens a rootfs archive: .tar.xz (Debian) or .tar.gz (Alpine, Ubuntu). */
    static InputStream openArchive(File tarball, String fileName) throws IOException {
        InputStream raw = new BufferedInputStream(new FileInputStream(tarball), 65536);
        try {
            return fileName.endsWith(".tar.xz") ? new XZInputStream(raw) : new GZIPInputStream(raw);
        } catch (IOException e) {
            raw.close();
            throw e;
        }
    }

    void install(Source src, Progress progress) throws IOException {
        if (isInstalled()) return;
        if (!src.id.equals(imageId)) throw new IOException("Source does not match this image");
        checkHost(src.tarballUrl);
        checkHost(src.checksumUrl);

        File downloads = new File(linuxDir, "download");
        //noinspection ResultOfMethodCallIgnored
        downloads.mkdirs();
        String fileName = src.fileName();
        // Prefix with the image id: Debian 12 and 13 both end in rootfs.tar.xz.
        File tarball = new File(downloads, src.id + "-" + fileName);

        progress.update("checksum", 0);
        String expected = fetchChecksum(src.checksumUrl, src.checksumListed, fileName);

        if (!tarball.isFile() || !expected.equals(sha256(tarball))) {
            download(src.tarballUrl, tarball, progress);
        }
        progress.update("verify", 100);
        if (!expected.equals(sha256(tarball))) {
            //noinspection ResultOfMethodCallIgnored
            tarball.delete();
            throw new IOException("Checksum mismatch for " + fileName + "; the download was discarded");
        }

        File partial = new File(imageDir(), "rootfs.partial");
        deleteRecursively(partial);
        //noinspection ResultOfMethodCallIgnored
        partial.mkdirs();
        progress.update("extract", 0);
        try (InputStream in = openArchive(tarball, fileName)) {
            extract(in, partial);
            writeDefaults(partial, src);
        } catch (IOException | RuntimeException e) {
            deleteRecursively(partial);
            throw e;
        }

        File target = rootfsDir();
        deleteRecursively(target);
        if (!partial.renameTo(target)) {
            deleteRecursively(partial);
            throw new IOException("Could not move the root filesystem into place");
        }
        if (!isInstalled()) {
            throw new IOException("The archive did not contain a root filesystem; the install is incomplete");
        }
        progress.update("done", 100);
    }

    // ---- download and verification -------------------------------------------------

    // ---- download and verification -------------------------------------------------

    /**
     * Reads the expected SHA-256 for fileName. For a listed file, finds the line that names it.
     * For a one-hash file, reads the first token. Throws if no valid hash is found.
     */
    private static String fetchChecksum(String url, boolean listed, String fileName) throws IOException {
        HttpURLConnection c = open(new URL(url));
        try (InputStream in = c.getInputStream()) {
            String text = new String(readAll(in), StandardCharsets.US_ASCII);
            if (!listed) {
                String hash = text.trim().split("\\s+")[0].toLowerCase(Locale.ROOT);
                if (!hash.matches("[0-9a-f]{64}")) throw new IOException("Unexpected checksum file from the mirror");
                return hash;
            }
            for (String line : text.split("\r?\n")) {
                String[] parts = line.trim().split("\\s+");
                if (parts.length < 2) continue;
                String name = parts[parts.length - 1].replaceFirst("^\\*", "");
                String hash = parts[0].toLowerCase(Locale.ROOT);
                if (name.equals(fileName) && hash.matches("[0-9a-f]{64}")) return hash;
            }
            throw new IOException("The published checksum list has no entry for " + fileName);
        } finally {
            c.disconnect();
        }
    }

    private static void download(String url, File dest, Progress progress) throws IOException {
        File tmp = new File(dest.getParentFile(), dest.getName() + ".part");
        HttpURLConnection c = open(new URL(url));
        long total = c.getContentLengthLong();
        try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(tmp)) {
            byte[] buf = new byte[65536];
            long done = 0;
            int lastPct = -1;
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
                done += n;
                if (total > 0) {
                    int pct = (int) Math.min(100, done * 100 / total);
                    if (pct != lastPct) {
                        lastPct = pct;
                        progress.update("download", pct);
                    }
                }
            }
        } finally {
            c.disconnect();
        }
        if (dest.exists() && !dest.delete()) throw new IOException("Could not replace " + dest.getName());
        if (!tmp.renameTo(dest)) throw new IOException("Could not save " + dest.getName());
    }

    private static HttpURLConnection open(URL url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        c.setConnectTimeout(30000);
        c.setReadTimeout(60000);
        c.setInstanceFollowRedirects(true);
        int code = c.getResponseCode();
        if (code != HttpURLConnection.HTTP_OK) {
            c.disconnect();
            throw new IOException("HTTP " + code + " from " + url.getHost());
        }
        return c;
    }

    private static String sha256(File f) throws IOException {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            try (InputStream in = new FileInputStream(f)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) != -1) md.update(buf, 0, n);
            }
            StringBuilder sb = new StringBuilder(64);
            for (byte b : md.digest()) sb.append(String.format(Locale.ROOT, "%02x", b & 0xff));
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IOException(e);
        }
    }

    // ---- tar extraction -----------------------------------------------------------

    private static void extract(InputStream in, File dest) throws IOException {
        byte[] header = new byte[512];
        String longName = null;
        String longLink = null;
        while (true) {
            readFully(in, header);
            if (isZeroBlock(header)) break;

            String name = cstring(header, 0, 100);
            long mode = octal(header, 100, 8);
            long size = octal(header, 124, 12);
            byte type = header[156];
            String link = cstring(header, 157, 100);
            if (isUstar(header)) {
                String prefix = cstring(header, 345, 155);
                if (!prefix.isEmpty()) name = prefix + "/" + name;
            }
            long padded = (size + 511) / 512 * 512;

            if (type == 'L' || type == 'K' || type == 'x' || type == 'g') {
                byte[] data = readBytes(in, size);
                skipFully(in, padded - size);
                if (type == 'L') {
                    longName = new String(data, 0, cstrLen(data, data.length), StandardCharsets.UTF_8);
                } else if (type == 'K') {
                    longLink = new String(data, 0, cstrLen(data, data.length), StandardCharsets.UTF_8);
                } else if (type == 'x') {
                    Map<String, String> pax = parsePax(data);
                    if (pax.containsKey("path")) longName = pax.get("path");
                    if (pax.containsKey("linkpath")) longLink = pax.get("linkpath");
                }
                continue;
            }
            if (longName != null) { name = longName; longName = null; }
            if (longLink != null) { link = longLink; longLink = null; }

            String rel = safeRelative(name);
            if (rel == null) {
                skipFully(in, padded);
                continue;
            }
            File target = new File(dest, rel);

            switch (type) {
                case '5': // directory
                    //noinspection ResultOfMethodCallIgnored
                    target.mkdirs();
                    chmod(target, mode);
                    skipFully(in, padded);
                    break;
                case '0':
                case '\0':
                case '7': // regular file: stream its bytes
                    //noinspection ResultOfMethodCallIgnored
                    target.getParentFile().mkdirs();
                    //noinspection ResultOfMethodCallIgnored
                    target.delete(); // never write through an existing symlink
                    try (OutputStream out = new FileOutputStream(target)) {
                        copy(in, out, size);
                    }
                    skipFully(in, padded - size);
                    chmod(target, mode);
                    break;
                case '2': // symlink
                    //noinspection ResultOfMethodCallIgnored
                    target.getParentFile().mkdirs();
                    //noinspection ResultOfMethodCallIgnored
                    target.delete();
                    try {
                        Os.symlink(link, target.getPath());
                    } catch (ErrnoException e) {
                        throw new IOException("symlink " + rel + ": " + e.getMessage(), e);
                    }
                    skipFully(in, padded);
                    break;
                case '1': { // hard link to another entry in the archive
                    String linkRel = safeRelative(link);
                    skipFully(in, padded);
                    if (linkRel == null) break;
                    //noinspection ResultOfMethodCallIgnored
                    target.getParentFile().mkdirs();
                    //noinspection ResultOfMethodCallIgnored
                    target.delete();
                    try {
                        Os.link(new File(dest, linkRel).getPath(), target.getPath());
                    } catch (ErrnoException e) {
                        throw new IOException("hard link " + rel + ": " + e.getMessage(), e);
                    }
                    break;
                }
                default: // devices, fifos and other special entries are not needed
                    skipFully(in, padded);
                    break;
            }
        }
    }

    private static void chmod(File f, long mode) {
        try {
            // Keep the owner able to read and write, whatever the archive says.
            Os.chmod(f.getPath(), (int) ((mode & 0777) | 0600));
        } catch (ErrnoException ignored) {
            // Best effort: some storage does not support mode changes.
        }
    }

    /** Returns the path relative to the root, or null for entries that do not name a path (such as "./"). */
    private static String safeRelative(String name) throws IOException {
        String n = name;
        while (n.startsWith("./")) n = n.substring(2);
        while (n.startsWith("/")) n = n.substring(1);
        while (n.endsWith("/")) n = n.substring(0, n.length() - 1);
        if (n.isEmpty() || n.equals(".")) return null;
        for (String part : n.split("/")) {
            if (part.equals("..")) throw new IOException("Unsafe path in the archive: " + name);
        }
        return n;
    }

    private static Map<String, String> parsePax(byte[] data) {
        Map<String, String> out = new HashMap<>();
        int pos = 0;
        while (pos < data.length) {
            int space = pos;
            while (space < data.length && data[space] != ' ') space++;
            if (space >= data.length) break;
            int len;
            try {
                len = Integer.parseInt(new String(data, pos, space - pos, StandardCharsets.US_ASCII));
            } catch (NumberFormatException e) {
                break;
            }
            if (len <= 0 || pos + len > data.length) break;
            int end = pos + len - 1; // drop the trailing newline
            String kv = new String(data, space + 1, end - (space + 1), StandardCharsets.UTF_8);
            int eq = kv.indexOf('=');
            if (eq > 0) out.put(kv.substring(0, eq), kv.substring(eq + 1));
            pos += len;
        }
        return out;
    }

    /** Writes DNS and hosts files. Alpine images also get apk repositories; Ubuntu images do not use apk. */
    private static void writeDefaults(File root, Source src) throws IOException {
        //noinspection ResultOfMethodCallIgnored
        new File(root, "root").mkdirs();
        //noinspection ResultOfMethodCallIgnored
        new File(root, "tmp").mkdirs();
        //noinspection ResultOfMethodCallIgnored
        new File(root, "etc").mkdirs();
        writeText(new File(root, "etc/resolv.conf"), "nameserver 1.1.1.1\nnameserver 8.8.8.8\n");
        writeText(new File(root, "etc/hosts"), "127.0.0.1 localhost\n");
        if (src.apkBranch != null && !src.apkBranch.isEmpty()) {
            //noinspection ResultOfMethodCallIgnored
            new File(root, "etc/apk").mkdirs();
            writeText(new File(root, "etc/apk/repositories"),
                "https://dl-cdn.alpinelinux.org/alpine/" + src.apkBranch + "/main\n"
                + "https://dl-cdn.alpinelinux.org/alpine/" + src.apkBranch + "/community\n");
        }
    }

    private static void writeText(File f, String text) throws IOException {
        try (OutputStream out = new FileOutputStream(f)) {
            out.write(text.getBytes(StandardCharsets.UTF_8));
        }
    }

    // ---- helpers ------------------------------------------------------------------

    private static boolean isZeroBlock(byte[] b) {
        for (byte x : b) if (x != 0) return false;
        return true;
    }

    private static boolean isUstar(byte[] h) {
        return h[257] == 'u' && h[258] == 's' && h[259] == 't' && h[260] == 'a' && h[261] == 'r';
    }

    /** The NUL-terminated string stored in b[off, off+len). */
    private static String cstring(byte[] b, int off, int len) {
        int end = off;
        int limit = off + len;
        while (end < limit && b[end] != 0) end++;
        return new String(b, off, end - off, StandardCharsets.UTF_8);
    }

    /** Length of the string at the start of b, up to end or the first NUL. */
    private static int cstrLen(byte[] b, int end) {
        int i = 0;
        while (i < end && b[i] != 0) i++;
        return i;
    }

    private static long octal(byte[] b, int off, int len) throws IOException {
        long v = 0;
        for (int i = off; i < off + len; i++) {
            byte c = b[i];
            if (c == 0 || c == ' ') {
                if (v != 0) break;
                continue;
            }
            if (c < '0' || c > '7') throw new IOException("Bad number in tar header");
            v = (v << 3) | (c - '0');
        }
        return v;
    }

    private static byte[] readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) != -1) bos.write(buf, 0, n);
        return bos.toByteArray();
    }

    private static void readFully(InputStream in, byte[] buf) throws IOException {
        int off = 0;
        while (off < buf.length) {
            int n = in.read(buf, off, buf.length - off);
            if (n == -1) throw new EOFException("Archive ended early");
            off += n;
        }
    }

    private static byte[] readBytes(InputStream in, long size) throws IOException {
        byte[] data = new byte[(int) size];
        readFully(in, data);
        return data;
    }

    private static void copy(InputStream in, OutputStream out, long size) throws IOException {
        byte[] buf = new byte[65536];
        long left = size;
        while (left > 0) {
            int n = in.read(buf, 0, (int) Math.min(buf.length, left));
            if (n == -1) throw new EOFException("Archive ended early");
            out.write(buf, 0, n);
            left -= n;
        }
    }

    private static void skipFully(InputStream in, long n) throws IOException {
        long left = n;
        byte[] buf = new byte[4096];
        while (left > 0) {
            int r = in.read(buf, 0, (int) Math.min(buf.length, left));
            if (r == -1) throw new EOFException("Archive ended early");
            left -= r;
        }
    }

    private static void deleteRecursively(File f) {
        if (!f.exists() && !isSymlink(f)) return;
        if (f.isDirectory() && !isSymlink(f)) {
            File[] kids = f.listFiles();
            if (kids != null) for (File k : kids) deleteRecursively(k);
        }
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    private static boolean isSymlink(File f) {
        try {
            StructStat st = Os.lstat(f.getPath());
            return OsConstants.S_ISLNK(st.st_mode);
        } catch (ErrnoException e) {
            return false;
        }
    }
}
