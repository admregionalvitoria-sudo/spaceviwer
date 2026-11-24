package com.spaceviewer.display;

import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

/**
 * TCP stream server on port 47813 for ultra-low-latency native transport.
 * Framing: 12-byte header + payload.
 * Types: 1 VIDEO, 2 AUDIO, 3 CONFIG, 4 PING, 5 PONG, 6 STATS, 7 READY, 8 BYE.
 * Contract: docs/ARQUITETURA-TELA-ESTENDIDA.md §3.5
 */
public final class StreamServer {
    public interface Listener {
        void onConfig(JSONObject config);
        void onVideo(byte[] au, boolean keyframe, long arrivalNanos);
        void onAudio(byte[] pcm);
        void onBye();
        void onDisconnected();
    }

    private static final String TAG = "SVStreamServer";
    private static final int MAX_PAYLOAD = 8 * 1024 * 1024; // 8 MiB

    private static final int TYPE_VIDEO = 1;
    private static final int TYPE_AUDIO = 2;
    private static final int TYPE_CONFIG = 3;
    private static final int TYPE_PING = 4;
    private static final int TYPE_PONG = 5;
    private static final int TYPE_STATS = 6;
    private static final int TYPE_READY = 7;
    private static final int TYPE_BYE = 8;

    private final Listener listener;
    private volatile boolean running;
    private ServerSocket server;
    private Thread acceptThread;

    private final Object clientLock = new Object();
    private Socket activeClient;
    private DataOutputStream activeOut;
    private Thread activeClientThread;

    public StreamServer(Listener listener) {
        this.listener = listener;
    }

    public synchronized void start() {
        if (running) return;
        running = true;
        acceptThread = new Thread(new Runnable() {
            @Override
            public void run() {
                acceptLoop();
            }
        }, "sv-stream-accept");
        acceptThread.start();
    }

    public synchronized void stop() {
        running = false;
        try {
            if (server != null) server.close();
        } catch (IOException ignored) {}
        closeActiveClient();
    }

    private void closeActiveClient() {
        synchronized (clientLock) {
            if (activeClient != null) {
                try {
                    activeClient.close();
                } catch (IOException ignored) {}
                activeClient = null;
                activeOut = null;
            }
        }
    }

    private void acceptLoop() {
        while (running) {
            try {
                ServerSocket socket = new ServerSocket();
                socket.setReuseAddress(true);
                socket.bind(new InetSocketAddress(DeviceInfoProvider.STREAM_PORT));
                server = socket;
                Log.i(TAG, "StreamServer listening on TCP " + DeviceInfoProvider.STREAM_PORT);

                while (running) {
                    final Socket client = socket.accept();
                    synchronized (clientLock) {
                        closeActiveClient();
                        activeClient = client;
                        activeClientThread = new Thread(new Runnable() {
                            @Override
                            public void run() {
                                handleClient(client);
                            }
                        }, "sv-stream-client");
                        activeClientThread.start();
                    }
                }
            } catch (IOException e) {
                if (running) {
                    Log.w(TAG, "StreamServer accept loop error, retrying in 2s", e);
                    try {
                        Thread.sleep(2000);
                    } catch (InterruptedException ignored) {}
                }
            }
        }
    }

    private void handleClient(Socket socket) {
        DataInputStream in = null;
        DataOutputStream out = null;
        try {
            socket.setTcpNoDelay(true);
            socket.setSoTimeout(6000);
            socket.setReceiveBufferSize(256 * 1024); // 256 KiB
            in = new DataInputStream(new BufferedInputStream(socket.getInputStream(), 64 * 1024));
            out = new DataOutputStream(new BufferedOutputStream(socket.getOutputStream(), 16 * 1024));

            synchronized (clientLock) {
                if (activeClient == socket) {
                    activeOut = out;
                } else {
                    socket.close();
                    return;
                }
            }

            Log.i(TAG, "Native stream client connected: " + socket.getRemoteSocketAddress());
            byte[] header = new byte[12];

            while (running && !socket.isClosed()) {
                in.readFully(header);
                long arrivalNanos = System.nanoTime();

                int b0 = header[0] & 0xff;
                int b1 = header[1] & 0xff;
                if (b0 != 0x53 || b1 != 0x56) { // 'S', 'V'
                    Log.e(TAG, "Invalid magic bytes from stream client: " + b0 + ", " + b1);
                    break;
                }

                int type = header[2] & 0xff;
                int flags = header[3] & 0xff;
                int length = ((header[4] & 0xff) << 24)
                           | ((header[5] & 0xff) << 16)
                           | ((header[6] & 0xff) << 8)
                           | (header[7] & 0xff);

                if (length < 0 || length > MAX_PAYLOAD) {
                    Log.e(TAG, "Payload length out of bounds: " + length);
                    break;
                }

                byte[] payload = new byte[length];
                if (length > 0) {
                    in.readFully(payload);
                }

                if (type == TYPE_VIDEO) {
                    boolean keyframe = (flags & 1) != 0;
                    listener.onVideo(payload, keyframe, arrivalNanos);
                } else if (type == TYPE_AUDIO) {
                    listener.onAudio(payload);
                } else if (type == TYPE_CONFIG) {
                    String jsonStr = new String(payload, StandardCharsets.UTF_8);
                    JSONObject json = new JSONObject(jsonStr);
                    listener.onConfig(json);
                } else if (type == TYPE_PING) {
                    // Echo PING payload immediately as PONG
                    sendFrame(TYPE_PONG, 0, payload);
                } else if (type == TYPE_BYE) {
                    listener.onBye();
                    break;
                }
            }
        } catch (Exception e) {
            if (running && !socket.isClosed()) {
                Log.i(TAG, "Stream client disconnected: " + e.getMessage());
            }
        } finally {
            boolean wasActive;
            synchronized (clientLock) {
                wasActive = (activeClient == socket);
                if (wasActive) {
                    activeClient = null;
                    activeOut = null;
                }
            }
            try {
                socket.close();
            } catch (IOException ignored) {}
            if (wasActive) {
                listener.onDisconnected();
            }
        }
    }

    private void sendFrame(int type, int flags, byte[] payload) throws IOException {
        synchronized (clientLock) {
            if (activeOut == null) return;
            byte[] header = new byte[12];
            header[0] = 0x53; // 'S'
            header[1] = 0x56; // 'V'
            header[2] = (byte) type;
            header[3] = (byte) flags;
            int len = payload != null ? payload.length : 0;
            header[4] = (byte) ((len >>> 24) & 0xff);
            header[5] = (byte) ((len >>> 16) & 0xff);
            header[6] = (byte) ((len >>> 8) & 0xff);
            header[7] = (byte) (len & 0xff);
            long nowMs = System.currentTimeMillis() & 0xffffffffL;
            header[8] = (byte) ((nowMs >>> 24) & 0xff);
            header[9] = (byte) ((nowMs >>> 16) & 0xff);
            header[10] = (byte) ((nowMs >>> 8) & 0xff);
            header[11] = (byte) (nowMs & 0xff);

            activeOut.write(header);
            if (payload != null && payload.length > 0) {
                activeOut.write(payload);
            }
            activeOut.flush();
        }
    }

    public void sendStats(JSONObject stats) {
        try {
            byte[] payload = stats.toString().getBytes(StandardCharsets.UTF_8);
            sendFrame(TYPE_STATS, 0, payload);
        } catch (Exception e) {
            Log.w(TAG, "Failed to send stats frame: " + e.getMessage());
        }
    }

    public void sendReady(JSONObject ready) {
        try {
            byte[] payload = ready.toString().getBytes(StandardCharsets.UTF_8);
            sendFrame(TYPE_READY, 0, payload);
        } catch (Exception e) {
            Log.w(TAG, "Failed to send ready frame: " + e.getMessage());
        }
    }
}
