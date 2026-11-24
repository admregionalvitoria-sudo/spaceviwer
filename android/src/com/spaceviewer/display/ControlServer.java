package com.spaceviewer.display;

import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** Minimal HTTP/1.1 control endpoint on TCP 47811: GET /info, POST /connect, POST /disconnect. */
public final class ControlServer {
    public interface Listener {
        /** Called on a worker thread with the validated /connect body. */
        void onConnectRequest(JSONObject request);
        void onDisconnectRequest();
    }

    private static final String TAG = "SVControl";
    private static final int MAX_BODY = 64 * 1024;

    private final DeviceInfoProvider info;
    private final Listener listener;
    private volatile boolean running;
    private ServerSocket server;
    private Thread acceptThread;

    public ControlServer(DeviceInfoProvider info, Listener listener) {
        this.info = info;
        this.listener = listener;
    }

    public synchronized void start() {
        if (running) return;
        running = true;
        acceptThread = new Thread(new Runnable() { @Override public void run() { acceptLoop(); } }, "sv-control");
        acceptThread.start();
    }

    public synchronized void stop() {
        running = false;
        try { if (server != null) server.close(); } catch (IOException ignored) { }
    }

    private void acceptLoop() {
        while (running) {
            try (ServerSocket socket = new ServerSocket()) {
                socket.setReuseAddress(true);
                socket.bind(new InetSocketAddress(DeviceInfoProvider.CONTROL_PORT));
                server = socket;
                while (running) {
                    final Socket client = socket.accept();
                    new Thread(new Runnable() { @Override public void run() { handle(client); } }, "sv-control-client").start();
                }
            } catch (IOException e) {
                if (running) {
                    Log.w(TAG, "control server error, retrying", e);
                    try { Thread.sleep(2000); } catch (InterruptedException ignored) { }
                }
            }
        }
    }

    private void handle(Socket client) {
        try (Socket socket = client) {
            socket.setSoTimeout(10000);
            InputStream in = socket.getInputStream();
            String head = readHead(in);
            if (head == null) return;
            String[] lines = head.split("\r\n");
            String[] request = lines[0].split(" ");
            if (request.length < 2) { respond(socket, 400, "{\"ok\":false,\"error\":\"bad request\"}"); return; }
            String method = request[0].toUpperCase(Locale.ROOT);
            String path = request[1];
            int q = path.indexOf('?');
            if (q >= 0) path = path.substring(0, q);
            int length = 0;
            for (int i = 1; i < lines.length; i++) {
                int colon = lines[i].indexOf(':');
                if (colon > 0 && lines[i].substring(0, colon).trim().equalsIgnoreCase("content-length")) {
                    length = Integer.parseInt(lines[i].substring(colon + 1).trim());
                }
            }
            if (length < 0 || length > MAX_BODY) { respond(socket, 413, "{\"ok\":false,\"error\":\"body too large\"}"); return; }
            byte[] body = new byte[length];
            int read = 0;
            while (read < length) {
                int n = in.read(body, read, length - read);
                if (n < 0) break;
                read += n;
            }
            String text = new String(body, 0, read, StandardCharsets.UTF_8);

            if ("OPTIONS".equals(method)) { respond(socket, 204, ""); return; }
            if ("GET".equals(method) && ("/info".equals(path) || "/".equals(path))) {
                respond(socket, 200, info.toJson().toString());
            } else if ("POST".equals(method) && "/connect".equals(path)) {
                JSONObject json = new JSONObject(text.isEmpty() ? "{}" : text);
                String host = json.optString("host", "");
                int port = json.optInt("port", 0);
                String sessionId = json.optString("sessionId", "");
                if (host.isEmpty() || port <= 0 || port > 65535 || sessionId.isEmpty()) {
                    respond(socket, 400, "{\"ok\":false,\"error\":\"host, port e sessionId sao obrigatorios\"}");
                    return;
                }
                listener.onConnectRequest(json);
                respond(socket, 200, "{\"ok\":true}");
            } else if ("POST".equals(method) && "/disconnect".equals(path)) {
                listener.onDisconnectRequest();
                respond(socket, 200, "{\"ok\":true}");
            } else {
                respond(socket, 404, "{\"ok\":false,\"error\":\"not found\"}");
            }
        } catch (Exception e) {
            Log.w(TAG, "request failed", e);
        }
    }

    private static String readHead(InputStream in) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        int last4 = 0;
        while (buffer.size() < 16 * 1024) {
            int b = in.read();
            if (b < 0) return buffer.size() == 0 ? null : buffer.toString("ISO-8859-1");
            buffer.write(b);
            // Header ends at CRLF CRLF.
            last4 = (last4 << 8) | (b & 0xff);
            if (last4 == 0x0D0A0D0A) {
                String head = buffer.toString("ISO-8859-1");
                return head.substring(0, head.length() - 4);
            }
        }
        return null;
    }

    private static void respond(Socket socket, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        String reason = status == 200 ? "OK" : status == 204 ? "No Content" : status == 404 ? "Not Found" : "Error";
        String header = "HTTP/1.1 " + status + " " + reason + "\r\n" +
            "Content-Type: application/json; charset=utf-8\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
            "Access-Control-Allow-Headers: Content-Type\r\n" +
            "Content-Length: " + bytes.length + "\r\n" +
            "Connection: close\r\n\r\n";
        OutputStream out = socket.getOutputStream();
        out.write(header.getBytes(StandardCharsets.ISO_8859_1));
        out.write(bytes);
        out.flush();
    }
}
