package com.traliran.aihub;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

/**
 * Foreground service that keeps the process alive while Linux work runs (a build, an
 * MCP server, an interactive shell). Android stops background processes otherwise.
 *
 * Reference counted: each running Linux task calls acquire() when it starts and
 * release() when it ends. The service runs while the count is above zero.
 *
 * Declared with foregroundServiceType="dataSync". On Android 15 and later, the system
 * limits how long a dataSync service may run in one day; long builds can hit that limit.
 */
public class LinuxKeepAliveService extends Service {
    private static final String CHANNEL_ID = "linux_tasks";
    private static final int NOTIFICATION_ID = 4101;
    private static final Object LOCK = new Object();
    private static int active = 0;

    /** Call when a Linux task starts. */
    static void acquire(Context context) {
        synchronized (LOCK) {
            active++;
            if (active == 1) {
                Intent intent = new Intent(context, LinuxKeepAliveService.class);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent);
                } else {
                    context.startService(intent);
                }
            }
        }
    }

    /** Call when a Linux task ends. Every acquire() must be matched by one release(). */
    static void release(Context context) {
        synchronized (LOCK) {
            if (active > 0) active--;
            if (active == 0) {
                context.stopService(new Intent(context, LinuxKeepAliveService.class));
            }
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ensureChannel();
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(
            this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        Notification notification = builder
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle("Linux task running")
            .setContentText("Traliran AI Hub is running a command in the background.")
            .setContentIntent(pi)
            .setOngoing(true)
            .build();

        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        return START_NOT_STICKY;
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "Linux tasks", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Shows while a Linux command, build or MCP server runs in the background");
        nm.createNotificationChannel(channel);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
