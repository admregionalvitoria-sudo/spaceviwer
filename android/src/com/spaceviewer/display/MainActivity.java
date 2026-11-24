package com.spaceviewer.display;

import android.app.Activity;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.media.AudioManager;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.GestureDetector;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import org.json.JSONObject;

/**
 * Fullscreen wireless-monitor receiver:
 * - FrameLayout root containing:
 *   1. WebView for idle / web player
 *   2. SurfaceView for native low-latency hardware decoding
 *   3. TextView for real-time stats overlay (double tap toggle)
 * - Discovery, control, and native stream servers.
 */
public class MainActivity extends Activity implements ControlServer.Listener, StreamServer.Listener {
    private static final String TAG = "SpaceViewerDisplay";

    private FrameLayout root;
    private WebView web;
    private SurfaceView surfaceView;
    private TextView statsOverlay;
    private boolean statsOverlayVisible = false;

    private DeviceInfoProvider info;
    private DiscoveryResponder discovery;
    private ControlServer control;
    private StreamServer streamServer;
    private NsdRegistrar nsd;
    private WifiManager.WifiLock wifiLock;

    private Surface currentSurface;
    private NativeVideoDecoder nativeDecoder;
    private NativeAudioPlayer nativeAudio;

    private int configWidth = 1920;
    private int configHeight = 1080;
    private boolean configAudio = false;
    private boolean configIntraRefresh = false;

    private boolean pageReady;
    private String pendingScript;

    private final Handler statsHandler = new Handler(Looper.getMainLooper());
    private final Runnable statsRunnable = new Runnable() {
        @Override
        public void run() {
            if (nativeDecoder != null && streamServer != null) {
                int fps = nativeDecoder.getFps();
                int decodeMs = nativeDecoder.getDecodeMs();
                int q = nativeDecoder.getQueueSize();
                int dropped = nativeDecoder.getDropped();
                int maxGapMs = nativeDecoder.getMaxGapMs();
                int w = nativeDecoder.getWidth();
                int h = nativeDecoder.getHeight();
                String codec = nativeDecoder.getCodecName();

                try {
                    JSONObject stats = new JSONObject();
                    stats.put("fps", fps);
                    stats.put("decodeMs", decodeMs);
                    stats.put("queue", q);
                    stats.put("dropped", dropped);
                    stats.put("maxGapMs", maxGapMs);
                    stats.put("width", w);
                    stats.put("height", h);
                    streamServer.sendStats(stats);
                } catch (Exception ignored) {}

                if (statsOverlay != null && statsOverlayVisible) {
                    String text = fps + " fps · " + decodeMs + " ms · fila " + q + " · descartes " + dropped + " · " + codec;
                    statsOverlay.setText(text);
                }

                statsHandler.postDelayed(this, 1000);
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        if (Build.VERSION.SDK_INT >= 28) {
            getWindow().getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }

        info = new DeviceInfoProvider(this);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        surfaceView = new SurfaceView(this);
        surfaceView.setVisibility(View.GONE);
        FrameLayout.LayoutParams surfaceParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT,
            Gravity.CENTER
        );
        root.addView(surfaceView, surfaceParams);

        surfaceView.getHolder().addCallback(new SurfaceHolder.Callback() {
            @Override
            public void surfaceCreated(SurfaceHolder holder) {
                currentSurface = holder.getSurface();
                if (surfaceView.getVisibility() == View.VISIBLE && nativeDecoder == null) {
                    createAndStartDecoder();
                }
            }

            @Override
            public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {
                currentSurface = holder.getSurface();
            }

            @Override
            public void surfaceDestroyed(SurfaceHolder holder) {
                currentSurface = null;
                if (nativeDecoder != null) {
                    nativeDecoder.release();
                    nativeDecoder = null;
                }
            }
        });

        final GestureDetector gestureDetector = new GestureDetector(this, new GestureDetector.SimpleOnGestureListener() {
            @Override
            public boolean onDoubleTap(MotionEvent e) {
                statsOverlayVisible = !statsOverlayVisible;
                if (statsOverlay != null) {
                    statsOverlay.setVisibility(statsOverlayVisible ? View.VISIBLE : View.GONE);
                    if (statsOverlayVisible && nativeDecoder != null) {
                        String text = nativeDecoder.getFps() + " fps · " + nativeDecoder.getDecodeMs() + " ms · fila "
                            + nativeDecoder.getQueueSize() + " · descartes " + nativeDecoder.getDropped() + " · "
                            + nativeDecoder.getCodecName();
                        statsOverlay.setText(text);
                    }
                }
                return true;
            }
        });

        surfaceView.setOnTouchListener(new View.OnTouchListener() {
            @Override
            public boolean onTouch(View v, MotionEvent event) {
                gestureDetector.onTouchEvent(event);
                return true;
            }
        });

        statsOverlay = new TextView(this);
        statsOverlay.setVisibility(View.GONE);
        statsOverlay.setTextColor(Color.WHITE);
        statsOverlay.setBackgroundColor(Color.argb(190, 10, 15, 25));
        statsOverlay.setPadding(24, 16, 24, 16);
        statsOverlay.setTextSize(13);
        statsOverlay.setTypeface(Typeface.MONOSPACE);
        FrameLayout.LayoutParams overlayParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.TOP | Gravity.START
        );
        overlayParams.setMargins(32, 32, 0, 0);
        root.addView(statsOverlay, overlayParams);

        setContentView(root);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        web.setKeepScreenOn(true);
        web.addJavascriptInterface(new Bridge(), "SpaceViewerAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                if (pendingScript != null) {
                    web.evaluateJavascript(pendingScript, null);
                    pendingScript = null;
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                Log.i(TAG, "[web] " + message.message() + " (" + message.sourceId() + ":" + message.lineNumber() + ")");
                return true;
            }
        });
        web.loadUrl("file:///android_asset/receiver.html");

        discovery = new DiscoveryResponder(this, info);
        control = new ControlServer(info, this);
        streamServer = new StreamServer(this);
        nsd = new NsdRegistrar(this, info);

        try {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                int lockMode = Build.VERSION.SDK_INT >= 29
                    ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                    : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
                wifiLock = wm.createWifiLock(lockMode, "SpaceViewerDisplay:WifiLock");
                wifiLock.setReferenceCounted(false);
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to create WifiLock: " + e.getMessage());
        }
    }

    private void updateSurfaceLayout() {
        if (configWidth <= 0 || configHeight <= 0 || surfaceView == null) return;
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                int screenW = root.getWidth();
                int screenH = root.getHeight();
                if (screenW <= 0 || screenH <= 0) {
                    DisplayMetrics dm = getResources().getDisplayMetrics();
                    screenW = dm.widthPixels;
                    screenH = dm.heightPixels;
                }
                if (screenW <= 0 || screenH <= 0) return;

                double targetRatio = (double) configWidth / (double) configHeight;
                double screenRatio = (double) screenW / (double) screenH;

                int viewW;
                int viewH;
                if (screenRatio > targetRatio) {
                    viewH = screenH;
                    viewW = (int) Math.round(screenH * targetRatio);
                } else {
                    viewW = screenW;
                    viewH = (int) Math.round(screenW / targetRatio);
                }

                FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(viewW, viewH, Gravity.CENTER);
                surfaceView.setLayoutParams(lp);
            }
        });
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        updateSurfaceLayout();
    }

    private synchronized void createAndStartDecoder() {
        if (currentSurface == null || !currentSurface.isValid()) return;
        if (nativeDecoder != null) {
            nativeDecoder.release();
        }
        nativeDecoder = new NativeVideoDecoder(currentSurface, new NativeVideoDecoder.Listener() {
            @Override
            public void onReady(final String codecName) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            JSONObject ready = new JSONObject();
                            ready.put("decoder", codecName);
                            if (streamServer != null) {
                                streamServer.sendReady(ready);
                            }
                            callJs("window.SpaceViewer && window.SpaceViewer.onNativeState && window.SpaceViewer.onNativeState('streaming', " + ready.toString() + ")");
                            acquireWifiLock();
                            startStatsReporting();
                        } catch (Exception e) {
                            Log.w(TAG, "Error handling decoder ready: " + e.getMessage());
                        }
                    }
                });
            }
        });
        nativeDecoder.setConfig(configWidth, configHeight, configIntraRefresh);
        nativeDecoder.start();
    }

    private void startStatsReporting() {
        statsHandler.removeCallbacks(statsRunnable);
        statsHandler.postDelayed(statsRunnable, 1000);
    }

    private void stopStatsReporting() {
        statsHandler.removeCallbacks(statsRunnable);
    }

    private synchronized void stopNativeSession() {
        stopStatsReporting();
        if (nativeDecoder != null) {
            nativeDecoder.release();
            nativeDecoder = null;
        }
        if (nativeAudio != null) {
            nativeAudio.release();
            nativeAudio = null;
        }
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (surfaceView != null) {
                    surfaceView.setVisibility(View.GONE);
                }
                if (statsOverlay != null) {
                    statsOverlay.setVisibility(View.GONE);
                    statsOverlayVisible = false;
                }
            }
        });
        callJs("window.SpaceViewer && window.SpaceViewer.onNativeState && window.SpaceViewer.onNativeState('idle', {})");
        releaseWifiLock();
    }

    private void acquireWifiLock() {
        try {
            if (wifiLock != null && !wifiLock.isHeld()) {
                wifiLock.acquire();
                Log.i(TAG, "WifiLock acquired");
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to acquire WifiLock: " + e.getMessage());
        }
    }

    private void releaseWifiLock() {
        try {
            if (wifiLock != null && wifiLock.isHeld()) {
                wifiLock.release();
                Log.i(TAG, "WifiLock released");
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to release WifiLock: " + e.getMessage());
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideSystemUi();
        discovery.start();
        control.start();
        nsd.start();
        if (streamServer != null) {
            streamServer.start();
        }
        callJs("window.SpaceViewer && window.SpaceViewer.onInfo(" + info.toJson() + ")");
    }

    @Override
    protected void onDestroy() {
        stopNativeSession();
        if (streamServer != null) {
            streamServer.stop();
            streamServer = null;
        }
        releaseWifiLock();
        wifiLock = null;
        discovery.stop();
        control.stop();
        nsd.stop();
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @SuppressWarnings("deprecation")
    private void hideSystemUi() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    private void callJs(final String script) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (web == null) return;
                if (pageReady) web.evaluateJavascript(script, null);
                else pendingScript = script;
            }
        });
    }

    // --- ControlServer.Listener ---

    @Override
    public void onConnectRequest(JSONObject request) {
        applyOrientation(request.optString("orientation", "landscape"));
        if ("native".equals(request.optString("transport"))) {
            if (streamServer != null) {
                streamServer.start();
            }
        }
        callJs("window.SpaceViewer && window.SpaceViewer.onConnect(" + request + ")");
    }

    @Override
    public void onDisconnectRequest() {
        stopNativeSession();
        callJs("window.SpaceViewer && window.SpaceViewer.onDisconnect()");
    }

    // --- StreamServer.Listener ---

    @Override
    public void onConfig(final JSONObject config) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                String orientation = config.optString("orientation", null);
                if (orientation != null && !orientation.isEmpty()) {
                    applyOrientation(orientation);
                }
                configWidth = config.optInt("width", 1920);
                configHeight = config.optInt("height", 1080);
                configAudio = config.optBoolean("audio", false);
                configIntraRefresh = config.optBoolean("intraRefresh", false);

                updateSurfaceLayout();
                if (surfaceView != null) {
                    surfaceView.setVisibility(View.VISIBLE);
                }

                if (configAudio) {
                    if (nativeAudio == null) {
                        nativeAudio = new NativeAudioPlayer();
                    }
                    nativeAudio.start();
                } else if (nativeAudio != null) {
                    nativeAudio.release();
                    nativeAudio = null;
                }

                if (nativeDecoder == null) {
                    if (currentSurface != null && currentSurface.isValid()) {
                        createAndStartDecoder();
                    }
                } else {
                    nativeDecoder.setConfig(configWidth, configHeight, configIntraRefresh);
                }
            }
        });
    }

    @Override
    public void onVideo(byte[] au, boolean keyframe, long arrivalNanos) {
        if (nativeDecoder != null) {
            nativeDecoder.feedVideo(au, keyframe, arrivalNanos);
        }
    }

    @Override
    public void onAudio(byte[] pcm) {
        if (nativeAudio != null) {
            nativeAudio.playChunk(pcm);
        }
    }

    @Override
    public void onBye() {
        stopNativeSession();
    }

    @Override
    public void onDisconnected() {
        stopNativeSession();
    }

    private void applyOrientation(final String orientation) {
        final String value = orientation == null ? "landscape" : orientation;
        info.setOrientation(value);
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if ("portrait".equals(value)) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT);
                else if ("auto".equals(value)) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR);
                else setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            }
        });
    }

    /** Methods callable from receiver.js as window.SpaceViewerAndroid.*. */
    private final class Bridge {
        @JavascriptInterface
        public String getInfo() {
            return info.toJson().toString();
        }

        @JavascriptInterface
        public void setOrientation(String orientation) {
            applyOrientation(orientation);
        }

        @JavascriptInterface
        public void setState(String state, String master) {
            info.setState(state, master);
            try {
                if ("streaming".equals(state) || "streaming-native".equals(state) || "connecting".equals(state)) {
                    acquireWifiLock();
                } else if ("idle".equals(state)) {
                    releaseWifiLock();
                }
            } catch (Exception e) {
                Log.w(TAG, "Error updating WifiLock for state " + state + ": " + e.getMessage());
            }
        }
    }
}
