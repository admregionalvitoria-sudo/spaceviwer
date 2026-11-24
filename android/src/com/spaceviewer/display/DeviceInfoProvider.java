package com.spaceviewer.display;

import android.content.Context;
import android.content.SharedPreferences;
import android.hardware.display.DisplayManager;
import android.os.Build;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Display;

import org.json.JSONException;
import org.json.JSONObject;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

/** Builds the DeviceInfo JSON shared with the PC (see docs/ARQUITETURA-TELA-ESTENDIDA.md, 3.1 & 3.5). */
public final class DeviceInfoProvider {
    public static final int PROTOCOL = 2;
    public static final int DISCOVERY_PORT = 47810;
    public static final int ANNOUNCE_PORT = 47812;
    public static final int CONTROL_PORT = 47811;
    public static final int STREAM_PORT = 47813;

    private final Context context;
    private final String id;
    private volatile String state = "idle";
    private volatile String connectedTo = null;
    private volatile String orientation = "landscape";

    public DeviceInfoProvider(Context context) {
        this.context = context.getApplicationContext();
        SharedPreferences prefs = this.context.getSharedPreferences("spaceviewer", Context.MODE_PRIVATE);
        String stored = prefs.getString("deviceId", null);
        if (stored == null) {
            stored = UUID.randomUUID().toString();
            prefs.edit().putString("deviceId", stored).apply();
        }
        id = stored;
    }

    public String getId() { return id; }

    public void setState(String state, String master) {
        this.state = state == null || state.isEmpty() ? "idle" : state;
        this.connectedTo = master == null || master.isEmpty() ? null : master;
    }

    public void setOrientation(String orientation) { this.orientation = orientation; }

    public String getName() {
        String name = null;
        try {
            if (Build.VERSION.SDK_INT >= 25) name = Settings.Global.getString(context.getContentResolver(), Settings.Global.DEVICE_NAME);
            if (name == null || name.trim().isEmpty()) name = Settings.Secure.getString(context.getContentResolver(), "bluetooth_name");
        } catch (Exception ignored) { }
        if (name == null || name.trim().isEmpty()) name = capitalize(Build.MANUFACTURER) + " " + Build.MODEL;
        return name.trim();
    }

    /** IPv4 addresses of active non-loopback interfaces, Wi-Fi/Ethernet first. */
    public static List<String> getIpAddresses() {
        List<String> preferred = new ArrayList<>();
        List<String> others = new ArrayList<>();
        try {
            for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nif.isUp() || nif.isLoopback()) continue;
                String n = nif.getName().toLowerCase();
                for (InetAddress address : Collections.list(nif.getInetAddresses())) {
                    if (!(address instanceof Inet4Address) || address.isLoopbackAddress() || address.isLinkLocalAddress()) continue;
                    String ip = address.getHostAddress();
                    if (n.startsWith("wlan") || n.startsWith("eth") || n.startsWith("ap") || n.startsWith("swlan")) preferred.add(ip);
                    else if (!n.startsWith("rmnet") && !n.startsWith("ccmni") && !n.startsWith("tun") && !n.startsWith("dummy")) others.add(ip);
                }
            }
        } catch (Exception ignored) { }
        preferred.addAll(others);
        return preferred;
    }

    /** Directed broadcast addresses of the active IPv4 networks. */
    public static List<InetAddress> getBroadcastAddresses() {
        List<InetAddress> result = new ArrayList<>();
        try {
            for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nif.isUp() || nif.isLoopback()) continue;
                for (InterfaceAddress address : nif.getInterfaceAddresses()) {
                    if (address.getBroadcast() != null) result.add(address.getBroadcast());
                }
            }
        } catch (Exception ignored) { }
        return result;
    }

    public JSONObject toJson() {
        JSONObject json = new JSONObject();
        try {
            int width = 1920, height = 1080;
            float refresh = 60f, density = 1f;
            DisplayManager dm = (DisplayManager) context.getSystemService(Context.DISPLAY_SERVICE);
            Display display = dm != null ? dm.getDisplay(Display.DEFAULT_DISPLAY) : null;
            if (display != null) {
                DisplayMetrics metrics = new DisplayMetrics();
                display.getRealMetrics(metrics);
                width = Math.max(metrics.widthPixels, metrics.heightPixels);
                height = Math.min(metrics.widthPixels, metrics.heightPixels);
                density = metrics.density;
                refresh = display.getRefreshRate();
                if (Build.VERSION.SDK_INT >= 23) {
                    for (Display.Mode mode : display.getSupportedModes()) refresh = Math.max(refresh, mode.getRefreshRate());
                }
            }
            List<String> ips = getIpAddresses();
            json.put("type", "spaceviewer-display");
            json.put("protocol", PROTOCOL);
            json.put("id", id);
            json.put("name", getName());
            json.put("model", Build.MODEL);
            json.put("manufacturer", Build.MANUFACTURER);
            json.put("android", Build.VERSION.RELEASE);
            json.put("appVersion", BuildConfigVersion.get(context));
            json.put("ip", ips.isEmpty() ? "" : ips.get(0));
            json.put("ips", new org.json.JSONArray(ips));
            json.put("controlPort", CONTROL_PORT);
            json.put("streamPort", STREAM_PORT);

            org.json.JSONArray caps = new org.json.JSONArray();
            caps.put("webrtc");
            caps.put("native-h264");
            caps.put("pcm-audio");
            json.put("capabilities", caps);

            json.put("width", width);
            json.put("height", height);
            json.put("refreshRate", Math.round(refresh));
            json.put("density", density);
            json.put("orientation", orientation);
            json.put("state", state);
            json.put("connectedTo", connectedTo == null ? JSONObject.NULL : connectedTo);
        } catch (JSONException ignored) { }
        return json;
    }

    private static String capitalize(String value) {
        if (value == null || value.isEmpty()) return "";
        return Character.toUpperCase(value.charAt(0)) + value.substring(1);
    }

    /** Reads versionName from the package manager (no generated BuildConfig without Gradle). */
    static final class BuildConfigVersion {
        static String get(Context context) {
            try {
                return context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }
    }
}
