package com.traliran.aihub;

import android.util.Base64;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Runs a shell inside the proot-based Linux root filesystem on a pseudo-terminal.
 *
 * Layout under the app's files directory:
 *   linux/rootfs   the Linux root filesystem (installed by a later step)
 *   linux/tmp      proot temporary directory
 *
 * Events to the web layer:
 *   data  { data: base64 }  bytes from the terminal
 *   exit  { code: number }  the shell has ended
 *
 * One session at a time. Starting a new session stops the previous one.
 */
@CapacitorPlugin(name = "LinuxShell")
public class LinuxShellPlugin extends Plugin {
    private static final String TAG = "LinuxShell";
    private static final String ROOTFS_REL = "linux/rootfs";
    private static final String TMP_REL = "linux/tmp";

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private volatile int pid = -1;
    private volatile int fd = -1;
    private final AtomicBoolean reaped = new AtomicBoolean(true);

    @PluginMethod
    public void start(PluginCall call) {
        File filesDir = getContext().getFilesDir();
        File rootfs = new File(filesDir, ROOTFS_REL);
        if (!new File(rootfs, "bin/sh").exists()) {
            call.reject("Linux is not installed yet", "NOT_INSTALLED");
            return;
        }
        int cols = call.getInt("cols", 80);
        int rows = call.getInt("rows", 24);

        stopSession();

        File tmp = new File(filesDir, TMP_REL);
        //noinspection ResultOfMethodCallIgnored
        tmp.mkdirs();

        String nativeDir = getContext().getApplicationInfo().nativeLibraryDir;
        String proot = nativeDir + "/libproot.so";

        List<String> argv = new ArrayList<>(Arrays.asList(
            proot,
            "-r", rootfs.getAbsolutePath(),
            "-b", "/dev",
            "-b", "/proc",
            "-w", "/root",
            "-L",
            "/bin/sh", "-l"
        ));
        List<String> env = new ArrayList<>(Arrays.asList(
            "PROOT_LOADER=" + nativeDir + "/libproot-loader.so",
            "PROOT_TMP_DIR=" + tmp.getAbsolutePath(),
            "PROOT_NO_SECCOMP=1",
            "HOME=/root",
            "USER=root",
            "TERM=xterm-256color",
            "LANG=C.UTF-8",
            "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
        ));

        int[] started = PtyBridge.spawn(
            proot,
            argv.toArray(new String[0]),
            env.toArray(new String[0]),
            filesDir.getAbsolutePath(),
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

    @Override
    protected void handleOnDestroy() {
        stopSession();
        io.shutdownNow();
        super.handleOnDestroy();
    }
}
