package com.traliran.aihub;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LinuxShellPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
