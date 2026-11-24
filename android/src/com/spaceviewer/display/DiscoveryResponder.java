package com.spaceviewer.display;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.util.Log;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.Set;

/** Answers SPACEVIEWER_DISCOVER_V1 on UDP 47810 and announces DeviceInfo on UDP 47812 every 3 s. */
public final class DiscoveryResponder {
    private static final String TAG = "SVDiscovery";
    private static final String PROBE = "SPACEVIEWER_DISCOVER_V1";

    private final DeviceInfoProvider info;
    private final WifiManager.MulticastLock lock;
    private volatile boolean running;
    private DatagramSocket responderSocket;
    private Thread responder;
    private Thread announcer;

    public DiscoveryResponder(Context context, DeviceInfoProvider info) {
        this.info = info;
        WifiManager wifi = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        lock = wifi != null ? wifi.createMulticastLock("spaceviewer-discovery") : null;
        if (lock != null) lock.setReferenceCounted(false);
    }

    public synchronized void start() {
        if (running) return;
        running = true;
        try { if (lock != null) lock.acquire(); } catch (Exception e) { Log.w(TAG, "multicast lock", e); }
        responder = new Thread(new Runnable() { @Override public void run() { respondLoop(); } }, "sv-discovery");
        announcer = new Thread(new Runnable() { @Override public void run() { announceLoop(); } }, "sv-announce");
        responder.start();
        announcer.start();
    }

    public synchronized void stop() {
        running = false;
        if (responderSocket != null) responderSocket.close();
        if (announcer != null) announcer.interrupt();
        try { if (lock != null && lock.isHeld()) lock.release(); } catch (Exception ignored) { }
    }

    private void respondLoop() {
        while (running) {
            try (DatagramSocket socket = new DatagramSocket(null)) {
                socket.setReuseAddress(true);
                socket.setBroadcast(true);
                socket.bind(new InetSocketAddress(DeviceInfoProvider.DISCOVERY_PORT));
                responderSocket = socket;
                byte[] buffer = new byte[1024];
                while (running) {
                    DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                    socket.receive(packet);
                    String text = new String(packet.getData(), 0, packet.getLength(), StandardCharsets.US_ASCII).trim();
                    if (!text.startsWith(PROBE)) continue;
                    byte[] reply = info.toJson().toString().getBytes(StandardCharsets.UTF_8);
                    socket.send(new DatagramPacket(reply, reply.length, packet.getAddress(), packet.getPort()));
                }
            } catch (Exception e) {
                if (running) {
                    Log.w(TAG, "responder error, retrying", e);
                    sleep(2000);
                }
            }
        }
    }

    private void announceLoop() {
        while (running) {
            try (DatagramSocket socket = new DatagramSocket()) {
                socket.setBroadcast(true);
                while (running) {
                    byte[] data = info.toJson().toString().getBytes(StandardCharsets.UTF_8);
                    Set<InetAddress> targets = new LinkedHashSet<>();
                    targets.add(InetAddress.getByName("255.255.255.255"));
                    targets.addAll(DeviceInfoProvider.getBroadcastAddresses());
                    for (InetAddress target : targets) {
                        try {
                            socket.send(new DatagramPacket(data, data.length, target, DeviceInfoProvider.ANNOUNCE_PORT));
                        } catch (Exception ignored) { }
                    }
                    Thread.sleep(3000);
                }
            } catch (InterruptedException e) {
                return;
            } catch (Exception e) {
                if (running) {
                    Log.w(TAG, "announce error, retrying", e);
                    sleep(3000);
                }
            }
        }
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) { }
    }
}
