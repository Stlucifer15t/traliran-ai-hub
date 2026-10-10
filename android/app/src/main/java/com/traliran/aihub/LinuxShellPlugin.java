package com.traliran.aihub;

import java.io.IOException;
import com.getcapacitor.JSArray;
import android.util.Base64;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Runs commands inside the proot-based Linux root filesystem.
 *
 * Layout under the app's files directory:
 *   linux/rootfs   the Linux root filesystem (installed by RootfsInstaller)
 *   linux/tmp      proot temporary directory and MCP stderr logs
 *
 * Methods:
 *   status                              { installed }
 *   install                             downloads the root filesystem (events: install)
 *   start   { cols, rows, cwd? }        interactive shell session (one at a time)
 *   write / resize / stop               drive the interactive session
 *   run     { command, cwd?, env?, timeoutSec? }
 *                                       one command to completion; resolves { code, output, timedOut }
 *   mcpStart { command, cwd?, env? }    stdio MCP server over pipes; resolves { handle }
 *   mcpSend  { handle, message }        one JSON-RPC message (newline added here)
 *   mcpStop  { handle }                 closes the server's stdin; SIGTERM after 2 s if still running
 *
 * Events to the web layer:
 *   data     { data: base64 }           bytes from the interactive terminal
 *   exit     { code }                   the interactive shell has ended
 *   install  { stage, percent }
 *   mcpMessage { handle, line }         one line of JSON from an MCP server
 *   mcpExit    { handle, code }         an MCP server has ended
 *
 * While any task runs, LinuxKeepAliveService keeps the process in the foreground.
 */
@CapacitorPlugin(name = "LinuxShell")
public class LinuxShellPlugin extends Plugin {
    private static final String TAG = "LinuxShell";
    private static final String TMP_REL = "linux/tmp";
    private static final int RUN_OUTPUT_LIMIT = 512 * 1024;
    private static final int MCP_LINE_LIMIT = 8 * 1024 * 1024;

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ExecutorService runs = Executors.newCachedThreadPool();
    private final AtomicBoolean installing = new AtomicBoolean(false);
    private volatile int pid = -1;
    private volatile int fd = -1;
    private final AtomicBoolean reaped = new AtomicBoolean(true);

    private final Map<Integer, StdioServer> mcpServers = new ConcurrentHashMap<>();
    private final AtomicInteger mcpSeq = new AtomicInteger(1);

    /** A stdio MCP server process and its pipe ends. */
    private static final class StdioServer {
        final int pid;
        final int inFd;
        volatile boolean inClosed;
        volatile boolean exited;

        StdioServer(int pid, int inFd) {
            this.pid = pid;
            this.inFd = inFd;
        }
    }

    /** Installer for the active image: start, run and MCP use its root filesystem. */
    private RootfsInstaller installer() {
        File filesDir = getContext().getFilesDir();
        return new RootfsInstaller(filesDir, RootfsInstaller.activeId(RootfsInstaller.linuxDirOf(filesDir)));
    }

    // ---- install and status ---------------------------------------------------------

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("installed", installer().isInstalled());
        result.put("active", RootfsInstaller.activeId(RootfsInstaller.linuxDirOf(getContext().getFilesDir())));
        call.resolve(result);
    }

    /**
     * Downloads and installs an image. With no id (or "builtin") it installs the built-in
     * Alpine. Otherwise the JS side passes the download addresses from its image catalog,
     * and the host must be on the allow-list in RootfsInstaller. Runs off the UI thread.
     */
    @PluginMethod
    public void install(PluginCall call) {
        File filesDir = getContext().getFilesDir();
        String id = call.getString("id", RootfsInstaller.BUILTIN_ID);
        if (!RootfsInstaller.validId(id)) {
            call.reject("Unknown image id", "BAD_IMAGE");
            return;
        }
        RootfsInstaller.Source src;
        if (RootfsInstaller.BUILTIN_ID.equals(id)) {
            src = RootfsInstaller.builtinSource();
        } else {
            String tarball = call.getString("tarballUrl", "");
            String checksum = call.getString("checksumUrl", "");
            Boolean listed = call.getBoolean("checksumListed", false);
            if (tarball.isEmpty() || checksum.isEmpty()) {
                call.reject("This image has no download address", "BAD_IMAGE");
                return;
            }
            src = new RootfsInstaller.Source(id, call.getString("distro", ""), tarball, checksum,
                listed != null && listed, call.getString("apkBranch", ""));
        }
        RootfsInstaller rootfs = new RootfsInstaller(filesDir, id);
        if (rootfs.isInstalled()) {
            call.resolve();
            return;
        }
        if (!installing.compareAndSet(false, true)) {
            call.reject("Installation is already running", "INSTALL_RUNNING");
            return;
        }
        Thread worker = new Thread(() -> {
            try {
                rootfs.install(src, (stage, percent) -> {
                    JSObject ev = new JSObject();
                    ev.put("stage", stage);
                    ev.put("percent", percent);
                    notifyListeners("install", ev);
                });
                call.resolve();
            } catch (Exception e) {
                Log.e(TAG, "Linux install failed", e);
                String msg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                call.reject("Install failed: " + msg, "INSTALL_FAILED");
            } finally {
                installing.set(false);
            }
        }, "linux-install");
        worker.setDaemon(true);
        worker.start();
    }

    /** Installed images and the active one. */
    @PluginMethod
    public void images(PluginCall call) {
        File linuxDir = RootfsInstaller.linuxDirOf(getContext().getFilesDir());
        JSArray ids = new JSArray();
        for (String id : RootfsInstaller.installedIds(linuxDir)) ids.put(id);
        JSObject result = new JSObject();
        result.put("installed", ids);
        result.put("active", RootfsInstaller.activeId(linuxDir));
        call.resolve(result);
    }

    /** Makes an installed image the one Linux runs in. Takes effect for the next shell. */
    @PluginMethod
    public void setActive(PluginCall call) {
        File linuxDir = RootfsInstaller.linuxDirOf(getContext().getFilesDir());
        String id = call.getString("id", "");
        if (!RootfsInstaller.installedIds(linuxDir).contains(id)) {
            call.reject("That image is not installed", "NOT_INSTALLED");
            return;
        }
        try {
            RootfsInstaller.setActive(linuxDir, id);
            call.resolve();
        } catch (IOException e) {
            call.reject("Could not switch image: " + e.getMessage(), "SET_FAILED");
        }
    }

    /** Deletes an installed image. The built-in image and the active image cannot be deleted. */
    @PluginMethod
    public void deleteImage(PluginCall call) {
        File linuxDir = RootfsInstaller.linuxDirOf(getContext().getFilesDir());
        String id = call.getString("id", "");
        if (id.equals(RootfsInstaller.activeId(linuxDir))) {
            call.reject("Switch to another image before deleting this one", "IS_ACTIVE");
            return;
        }
        try {
            RootfsInstaller.deleteImage(linuxDir, id);
            call.resolve();
        } catch (IOException e) {
            call.reject("Could not delete the image: " + e.getMessage(), "DELETE_FAILED");
        }
    }

    // ---- shared command setup ---------------------------------------------------------

    /** proot argv that runs args inside the root filesystem with cwd as the working directory. */
    private List<String> prootArgv(String cwd, String... args) {
        String rootfs = installer().rootfsDir().getAbsolutePath();
        List<String> argv = new ArrayList<>(Arrays.asList(
            nativeDir() + "/libproot.so",
            "-r", rootfs,
            "-b", "/dev",
            "-b", "/proc",
            "-w", cwd,
            "-L"
        ));
        argv.addAll(Arrays.asList(args));
        return argv;
    }

    private List<String> prootEnv(JSObject extra) {
        File tmp = new File(getContext().getFilesDir(), TMP_REL);
        //noinspection ResultOfMethodCallIgnored
        tmp.mkdirs();
        List<String> env = new ArrayList<>(Arrays.asList(
            "PROOT_LOADER=" + nativeDir() + "/libproot-loader.so",
            "PROOT_TMP_DIR=" + tmp.getAbsolutePath(),
            "PROOT_NO_SECCOMP=1",
            "HOME=/root",
            "USER=root",
            "TERM=xterm-256color",
            "LANG=C.UTF-8",
            "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
        ));
        if (extra != null) {
            Iterator<String> keys = extra.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                // Only plain variable names; anything else would be a shell or proot injection.
                if (k.matches("[A-Za-z_][A-Za-z0-9_]*")) {
                    env.add(k + "=" + extra.optString(k, ""));
                }
            }
        }
        return env;
    }

    private String nativeDir() {
        return getContext().getApplicationInfo().nativeLibraryDir;
    }

    private String filesDir() {
        return getContext().getFilesDir().getAbsolutePath();
    }

    private static String safeCwd(String cwd) {
        if (cwd == null || cwd.isEmpty()) return "/root";
        if (!cwd.startsWith("/") || cwd.contains("..") || cwd.contains("\0")) return "/root";
        return cwd;
    }

    // ---- interactive session ----------------------------------------------------------

    @PluginMethod
    public void start(PluginCall call) {
        if (!installer().isInstalled()) {
            call.reject("Linux is not installed yet", "NOT_INSTALLED");
            return;
        }
        int cols = call.getInt("cols", 80);
        int rows = call.getInt("rows", 24);
        String cwd = safeCwd(call.getString("cwd", "/root"));

        stopSession();

        List<String> argv = prootArgv(cwd, "/bin/sh", "-l");
        List<String> env = prootEnv(null);
        int[] started = PtyBridge.spawn(
            argv.get(0),
            argv.toArray(new String[0]),
            env.toArray(new String[0]),
            filesDir(),
            cols,
            rows
        );
        if (started == null) {
            call.reject("Could not start the terminal", "SPAWN_FAILED");
            return;
        }

        final int childPid = started[0];
        final int masterFd = started[1];
        pid = childPid;
        fd = masterFd;
        reaped.set(false);
        LinuxKeepAliveService.acquire(getContext());

        Thread reader = new Thread(() -> readLoop(childPid, masterFd), "linux-shell-reader");
        reader.setDaemon(true);
        reader.start();

        JSObject result = new JSObject();
        result.put("pid", childPid);
        call.resolve(result);
    }

    private void readLoop(int childPid, int masterFd) {
        byte[] buf = new byte[4096];
        while (true) {
            int n = PtyBridge.read(masterFd, buf);
            if (n <= 0) break;
            JSObject ev = new JSObject();
            ev.put("data", Base64.encodeToString(buf, 0, n, Base64.NO_WRAP));
            notifyListeners("data", ev);
        }
        int code = PtyBridge.waitFor(childPid);
        reaped.set(true);
        PtyBridge.close(masterFd);
        if (pid == childPid) {
            pid = -1;
            fd = -1;
        }
        LinuxKeepAliveService.release(getContext());
        JSObject ev = new JSObject();
        ev.put("code", code);
        notifyListeners("exit", ev);
    }

    @PluginMethod
    public void write(PluginCall call) {
        final int target = fd;
        if (target < 0) {
            call.reject("No terminal session is running", "NOT_RUNNING");
            return;
        }
        final byte[] data = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
        io.execute(() -> {
            if (PtyBridge.write(target, data, data.length) < 0) {
                Log.w(TAG, "write to terminal failed");
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void resize(PluginCall call) {
        final int target = fd;
        if (target >= 0) {
            PtyBridge.resize(target, call.getInt("cols", 80), call.getInt("rows", 24));
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopSession();
        call.resolve();
    }

    /** Sends SIGHUP and, if the shell is still alive after two seconds, SIGKILL. */
    private void stopSession() {
        final int childPid = pid;
        if (childPid < 0) return;
        final AtomicBoolean done = reaped;
        PtyBridge.kill(childPid, 1);
        Thread killer = new Thread(() -> {
            try {
                Thread.sleep(2000);
            } catch (InterruptedException ignored) {
                return;
            }
            if (!done.get()) PtyBridge.kill(childPid, 9);
        }, "linux-shell-killer");
        killer.setDaemon(true);
        killer.start();
    }

    // ---- one-shot commands ------------------------------------------------------------

    /**
     * Runs `sh -lc command` on its own pseudo-terminal, collects its output, and resolves
     * with { code, output, timedOut }. Output past 512 KB is dropped. Independent of the
     * interactive session.
     */
    @PluginMethod
    public void run(PluginCall call) {
        final String command = call.getString("command", "");
        if (command.isEmpty()) {
            call.reject("No command given", "BAD_REQUEST");
            return;
        }
        if (!installer().isInstalled()) {
            call.reject("Linux is not installed yet", "NOT_INSTALLED");
            return;
        }
        final String cwd = safeCwd(call.getString("cwd", "/root"));
        final int timeoutSec = Math.max(1, Math.min(call.getInt("timeoutSec", 600), 3600));
        final JSObject extra = call.getObject("env");

        runs.execute(() -> {
            try {
                call.resolve(runToCompletion(command, cwd, extra, timeoutSec));
            } catch (Exception e) {
                Log.e(TAG, "run failed", e);
                String msg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                call.reject("Command failed to run: " + msg, "RUN_FAILED");
            }
        });
    }

    private JSObject runToCompletion(String command, String cwd, JSObject extra, int timeoutSec) throws Exception {
        List<String> argv = prootArgv(cwd, "/bin/sh", "-lc", command);
        List<String> env = prootEnv(extra);
        LinuxKeepAliveService.acquire(getContext());
        try {
            int[] started = PtyBridge.spawn(
                argv.get(0),
                argv.toArray(new String[0]),
                env.toArray(new String[0]),
                filesDir(),
                200,
                50
            );
            if (started == null) throw new IllegalStateException("could not start proot");
            final int childPid = started[0];
            final int masterFd = started[1];

            final ByteArrayOutputStream out = new ByteArrayOutputStream();
            Thread reader = new Thread(() -> {
                byte[] buf = new byte[4096];
                while (true) {
                    int n = PtyBridge.read(masterFd, buf);
                    if (n <= 0) break;
                    synchronized (out) {
                        if (out.size() < RUN_OUTPUT_LIMIT) {
                            out.write(buf, 0, Math.min(n, RUN_OUTPUT_LIMIT - out.size()));
                        }
                    }
                }
            }, "linux-run-reader");
            reader.setDaemon(true);
            reader.start();

            reader.join(timeoutSec * 1000L);
            boolean timedOut = reader.isAlive();
            if (timedOut) PtyBridge.kill(childPid, 9);
            int code = PtyBridge.waitFor(childPid);
            reader.join(2000);
            PtyBridge.close(masterFd);

            String text;
            synchronized (out) {
                text = new String(out.toByteArray(), StandardCharsets.UTF_8);
            }
            JSObject result = new JSObject();
            result.put("code", code);
            result.put("output", text);
            result.put("timedOut", timedOut);
            return result;
        } finally {
            LinuxKeepAliveService.release(getContext());
        }
    }

    // ---- stdio MCP servers ----------------------------------------------------------------

    /** Starts a server command with plain pipes. Each line the server writes arrives as mcpMessage. */
    @PluginMethod
    public void mcpStart(PluginCall call) {
        final String command = call.getString("command", "");
        if (command.isEmpty()) {
            call.reject("No command given", "BAD_REQUEST");
            return;
        }
        if (!installer().isInstalled()) {
            call.reject("Linux is not installed yet", "NOT_INSTALLED");
            return;
        }
        final String cwd = safeCwd(call.getString("cwd", "/root/projects"));
        final JSObject extra = call.getObject("env");
        final int handle = mcpSeq.getAndIncrement();

        File tmp = new File(getContext().getFilesDir(), TMP_REL);
        //noinspection ResultOfMethodCallIgnored
        tmp.mkdirs();
        File errLog = new File(tmp, "mcp-" + handle + ".log");

        List<String> argv = prootArgv(cwd, "/bin/sh", "-lc", command);
        List<String> env = prootEnv(extra);
        int[] pipes = PtyBridge.spawnPipes(
            argv.get(0),
            argv.toArray(new String[0]),
            env.toArray(new String[0]),
            filesDir(),
            errLog.getAbsolutePath()
        );
        if (pipes == null) {
            call.reject("Could not start the MCP server", "SPAWN_FAILED");
            return;
        }

        final StdioServer server = new StdioServer(pipes[0], pipes[1]);
        final int outFd = pipes[2];
        mcpServers.put(handle, server);
        LinuxKeepAliveService.acquire(getContext());

        Thread reader = new Thread(() -> mcpReadLoop(handle, server, outFd), "linux-mcp-reader-" + handle);
        reader.setDaemon(true);
        reader.start();

        JSObject result = new JSObject();
        result.put("handle", handle);
        call.resolve(result);
    }

    private void mcpReadLoop(int handle, StdioServer server, int outFd) {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        boolean tooLong = false;
        while (true) {
            int n = PtyBridge.read(outFd, buf);
            if (n <= 0) break;
            for (int i = 0; i < n; i++) {
                byte b = buf[i];
                if (b == '\n') {
                    if (!tooLong) emitMcpLine(handle, line.toByteArray());
                    line.reset();
                    tooLong = false;
                } else if (!tooLong) {
                    if (line.size() >= MCP_LINE_LIMIT) {
                        tooLong = true;
                        Log.w(TAG, "MCP server " + handle + " sent a line over the size limit; dropped");
                    } else {
                        line.write(b);
                    }
                }
            }
        }
        if (!tooLong && line.size() > 0) emitMcpLine(handle, line.toByteArray());

        int code = PtyBridge.waitFor(server.pid);
        server.exited = true;
        PtyBridge.close(outFd);
        mcpServers.remove(handle);
        // The write side must be closed on the io thread, after any pending writes.
        io.execute(() -> {
            if (!server.inClosed) {
                server.inClosed = true;
                PtyBridge.close(server.inFd);
            }
        });
        LinuxKeepAliveService.release(getContext());
        JSObject ev = new JSObject();
        ev.put("handle", handle);
        ev.put("code", code);
        notifyListeners("mcpExit", ev);
    }

    private void emitMcpLine(int handle, byte[] raw) {
        int len = raw.length;
        if (len > 0 && raw[len - 1] == '\r') len--;
        if (len == 0) return;
        JSObject ev = new JSObject();
        ev.put("handle", handle);
        ev.put("line", new String(raw, 0, len, StandardCharsets.UTF_8));
        notifyListeners("mcpMessage", ev);
    }

    @PluginMethod
    public void mcpSend(PluginCall call) {
        final StdioServer server = mcpServers.get(call.getInt("handle", -1));
        if (server == null || server.exited || server.inClosed) {
            call.reject("MCP server is not running", "NOT_RUNNING");
            return;
        }
        final byte[] bytes = (call.getString("message", "") + "\n").getBytes(StandardCharsets.UTF_8);
        io.execute(() -> {
            if (server.inClosed) return;
            if (PtyBridge.write(server.inFd, bytes, bytes.length) < 0) {
                Log.w(TAG, "write to MCP server failed");
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void mcpStop(PluginCall call) {
        final int handle = call.getInt("handle", -1);
        final StdioServer server = mcpServers.get(handle);
        if (server == null) {
            call.resolve();
            return;
        }
        // Closing stdin tells a well-behaved MCP server to exit.
        io.execute(() -> {
            if (!server.inClosed) {
                server.inClosed = true;
                PtyBridge.close(server.inFd);
            }
        });
        Thread killer = new Thread(() -> {
            try {
                Thread.sleep(2000);
            } catch (InterruptedException ignored) {
                return;
            }
            if (!server.exited) PtyBridge.kill(server.pid, 15);
        }, "linux-mcp-killer-" + handle);
        killer.setDaemon(true);
        killer.start();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        stopSession();
        for (StdioServer server : mcpServers.values()) {
            PtyBridge.kill(server.pid, 15);
        }
        io.shutdownNow();
        runs.shutdownNow();
        super.handleOnDestroy();
    }
}
