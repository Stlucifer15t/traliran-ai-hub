package com.traliran.aihub;

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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Runs commands inside the proot-based Linux root filesystem on a pseudo-terminal.
 *
 * Layout under the app's files directory:
 *   linux/rootfs   the Linux root filesystem (installed by RootfsInstaller)
 *   linux/tmp      proot temporary directory
 *
 * Methods:
 *   status                         { installed }
 *   install                        downloads the root filesystem (events: install)
 *   start   { cols, rows, cwd? }   interactive shell session (one at a time)
 *   write / resize / stop          drive the interactive session
 *   run     { command, cwd?, env?, timeoutSec? }
 *                                  runs one command to completion; resolves { code, output, timedOut }
 *
 * Events to the web layer:
 *   data  { data: base64 }  bytes from the interactive terminal
 *   exit  { code: number }  the interactive shell has ended
 *   install { stage, percent }
 */
@CapacitorPlugin(name = "LinuxShell")
public class LinuxShellPlugin extends Plugin {
    private static final String TAG = "LinuxShell";
    private static final String TMP_REL = "linux/tmp";
    private static final int RUN_OUTPUT_LIMIT = 512 * 1024;

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ExecutorService runs = Executors.newCachedThreadPool();
    private final AtomicBoolean installing = new AtomicBoolean(false);
    private volatile int pid = -1;
    private volatile int fd = -1;
    private final AtomicBoolean reaped = new AtomicBoolean(true);

    private RootfsInstaller installer() {
        return new RootfsInstaller(getContext().getFilesDir());
    }

    // ---- install and status ---------------------------------------------------------

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("installed", installer().isInstalled());
        call.resolve(result);
    }

    /** Downloads and installs the root filesystem. Runs off the UI thread. */
    @PluginMethod
    public void install(PluginCall call) {
        RootfsInstaller rootfs = installer();
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
                rootfs.install((stage, percent) -> {
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
            getContext().getFilesDir().getAbsolutePath(),
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
        int[] started = PtyBridge.spawn(
            argv.get(0),
            argv.toArray(new String[0]),
            env.toArray(new String[0]),
            getContext().getFilesDir().getAbsolutePath(),
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
    }

    @Override
    protected void handleOnDestroy() {
        stopSession();
        io.shutdownNow();
        runs.shutdownNow();
        super.handleOnDestroy();
    }
}
