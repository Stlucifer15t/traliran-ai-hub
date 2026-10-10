/*
 * JNI bridge for the Linux terminal: spawn a child on a pseudo-terminal,
 * read and write its master side, resize, wait for it and signal it.
 *
 * Built for Android arm64 by .github/workflows/android.yml (NDK clang, API 24+).
 * Java side: com.traliran.aihub.PtyBridge. No threads are created here.
 */
#include <errno.h>
#include <fcntl.h>
#include <jni.h>
#include <pty.h>
#include <signal.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

#define IO_CHUNK 4096

/* Copy a Java String[] into a NULL-terminated char* array. Caller frees with free_cstr_array. */
static char **to_cstr_array(JNIEnv *env, jobjectArray arr) {
    jsize n = arr ? (*env)->GetArrayLength(env, arr) : 0;
    char **out = calloc((size_t)n + 1, sizeof(char *));
    if (!out) return NULL;
    for (jsize i = 0; i < n; i++) {
        jstring s = (jstring)(*env)->GetObjectArrayElement(env, arr, i);
        const char *c = (*env)->GetStringUTFChars(env, s, NULL);
        out[i] = c ? strdup(c) : strdup("");
        if (c) (*env)->ReleaseStringUTFChars(env, s, c);
        (*env)->DeleteLocalRef(env, s);
    }
    return out;
}

static void free_cstr_array(char **arr) {
    if (!arr) return;
    for (char **p = arr; *p; p++) free(*p);
    free(arr);
}

/*
 * spawn(exe, argv, envp, cwd, cols, rows) -> int[]{pid, masterFd} or null.
 * The child becomes a session leader whose controlling terminal is the slave side.
 */
JNIEXPORT jintArray JNICALL
Java_com_traliran_aihub_PtyBridge_spawn(JNIEnv *env, jclass cls, jstring jexe,
                                        jobjectArray jargv, jobjectArray jenvp,
                                        jstring jcwd, jint cols, jint rows) {
    (void)cls;
    jintArray result = NULL;
    const char *exe = jexe ? (*env)->GetStringUTFChars(env, jexe, NULL) : NULL;
    const char *cwd = jcwd ? (*env)->GetStringUTFChars(env, jcwd, NULL) : NULL;
    char **argv = to_cstr_array(env, jargv);
    char **envp = to_cstr_array(env, jenvp);

    struct winsize ws;
    memset(&ws, 0, sizeof(ws));
    ws.ws_col = (unsigned short)(cols > 0 ? cols : 80);
    ws.ws_row = (unsigned short)(rows > 0 ? rows : 24);

    int master = -1, slave = -1;
    if (exe && argv && envp && openpty(&master, &slave, NULL, NULL, &ws) == 0) {
        /* Everything the child needs is prepared above; it must not touch the JVM. */
        pid_t pid = fork();
        if (pid == 0) {
            setsid();
            ioctl(slave, TIOCSCTTY, 0);
            dup2(slave, 0);
            dup2(slave, 1);
            dup2(slave, 2);
            if (slave > 2) close(slave);
            close(master);
            if (cwd) (void)chdir(cwd);
            execve(exe, argv, envp);
            _exit(127);
        }
        close(slave);
        if (pid > 0) {
            fcntl(master, F_SETFD, FD_CLOEXEC);
            jint vals[2] = { (jint)pid, (jint)master };
            result = (*env)->NewIntArray(env, 2);
            if (result) (*env)->SetIntArrayRegion(env, result, 0, 2, vals);
        } else {
            close(master);
        }
    }

    free_cstr_array(argv);
    free_cstr_array(envp);
    if (cwd) (*env)->ReleaseStringUTFChars(env, jcwd, cwd);
    if (exe) (*env)->ReleaseStringUTFChars(env, jexe, exe);
    return result;
}

/* read(fd, buf) -> bytes read, 0 on end of file, -1 on error. */
JNIEXPORT jint JNICALL
Java_com_traliran_aihub_PtyBridge_read(JNIEnv *env, jclass cls, jint fd, jbyteArray jbuf) {
    (void)cls;
    jsize cap = (*env)->GetArrayLength(env, jbuf);
    if (cap > IO_CHUNK) cap = IO_CHUNK;
    jbyte tmp[IO_CHUNK];
    ssize_t n;
    do {
        n = read(fd, tmp, (size_t)cap);
    } while (n < 0 && errno == EINTR);
    if (n > 0) (*env)->SetByteArrayRegion(env, jbuf, 0, (jsize)n, tmp);
    return (jint)n;
}

/* write(fd, data, len) -> bytes written (== len), or -1 on error. */
JNIEXPORT jint JNICALL
Java_com_traliran_aihub_PtyBridge_write(JNIEnv *env, jclass cls, jint fd, jbyteArray jdata, jint len) {
    (void)cls;
    jbyte tmp[IO_CHUNK];
    jint total = 0;
    while (total < len) {
        jint chunk = len - total;
        if (chunk > IO_CHUNK) chunk = IO_CHUNK;
        (*env)->GetByteArrayRegion(env, jdata, total, chunk, tmp);
        ssize_t n = write(fd, tmp, (size_t)chunk);
        if (n < 0) {
            if (errno == EINTR) continue;
            return -1;
        }
        total += (jint)n;
    }
    return total;
}

JNIEXPORT void JNICALL
Java_com_traliran_aihub_PtyBridge_resize(JNIEnv *env, jclass cls, jint fd, jint cols, jint rows) {
    (void)env;
    (void)cls;
    struct winsize ws;
    memset(&ws, 0, sizeof(ws));
    ws.ws_col = (unsigned short)(cols > 0 ? cols : 80);
    ws.ws_row = (unsigned short)(rows > 0 ? rows : 24);
    ioctl(fd, TIOCSWINSZ, &ws);
}

/* waitFor(pid) -> exit status, 128+signal if killed by a signal, -1 on error. Blocks. */
JNIEXPORT jint JNICALL
Java_com_traliran_aihub_PtyBridge_waitFor(JNIEnv *env, jclass cls, jint pid) {
    (void)env;
    (void)cls;
    int status = 0;
    pid_t r;
    do {
        r = waitpid((pid_t)pid, &status, 0);
    } while (r < 0 && errno == EINTR);
    if (r < 0) return -1;
    if (WIFEXITED(status)) return (jint)WEXITSTATUS(status);
    if (WIFSIGNALED(status)) return (jint)(128 + WTERMSIG(status));
    return -1;
}

JNIEXPORT void JNICALL
Java_com_traliran_aihub_PtyBridge_kill(JNIEnv *env, jclass cls, jint pid, jint sig) {
    (void)env;
    (void)cls;
    kill((pid_t)pid, sig);
}

JNIEXPORT void JNICALL
Java_com_traliran_aihub_PtyBridge_close(JNIEnv *env, jclass cls, jint fd) {
    (void)env;
    (void)cls;
    close(fd);
}
