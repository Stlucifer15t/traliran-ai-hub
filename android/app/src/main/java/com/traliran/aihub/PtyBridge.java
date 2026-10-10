package com.traliran.aihub;

/**
 * Thin JNI wrapper around libptyhelper.so (native/ptyhelper/pty_jni.c).
 * Spawns a child process on a pseudo-terminal and moves bytes through its master side.
 */
final class PtyBridge {
    static {
        System.loadLibrary("ptyhelper");
    }

    private PtyBridge() {}

    /** Returns {pid, masterFd}, or null when the child could not be started. */
    static native int[] spawn(String exe, String[] argv, String[] envp, String cwd, int cols, int rows);

    /**
     * Starts a child with plain pipes (no terminal): returns {pid, stdinFd, stdoutFd}, or null.
     * stderr is written to stderrPath. Used for stdio MCP servers.
     */
    static native int[] spawnPipes(String exe, String[] argv, String[] envp, String cwd, String stderrPath);

    /** Blocking read from the master fd. Returns bytes read, 0 at end of file, -1 on error. */
    static native int read(int fd, byte[] buf);

    /** Writes len bytes from data to the master fd. Returns len, or -1 on error. */
    static native int write(int fd, byte[] data, int len);

    static native void resize(int fd, int cols, int rows);

    /** Blocks until the child exits. Returns its exit status, or 128+signal when killed by a signal. */
    static native int waitFor(int pid);

    static native void kill(int pid, int signal);

    static native void close(int fd);
}
