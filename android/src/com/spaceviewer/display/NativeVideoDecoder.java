package com.spaceviewer.display;

import android.media.MediaCodec;
import android.media.MediaFormat;
import android.os.Build;
import android.util.Log;
import android.view.Surface;

import org.json.JSONObject;

import java.nio.ByteBuffer;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Low-latency H.264 (video/avc) hardware decoder rendering directly to a Surface.
 * Feeds Annex-B access units into MediaCodec.
 * Drops backlog to keep frame delivery at ultra-low latency.
 */
public final class NativeVideoDecoder {
    public interface Listener {
        void onReady(String codecName);
    }

    private static final String TAG = "SVNativeDecoder";
    private static final int QUEUE_CAPACITY = 8;

    private static final class QueuedFrame {
        final byte[] data;
        final boolean keyframe;
        final long ptsUs;

        QueuedFrame(byte[] data, boolean keyframe, long ptsUs) {
            this.data = data;
            this.keyframe = keyframe;
            this.ptsUs = ptsUs;
        }
    }

    private final Surface surface;
    private final Listener listener;
    private final LinkedBlockingQueue<QueuedFrame> queue = new LinkedBlockingQueue<QueuedFrame>(QUEUE_CAPACITY);
    private final AtomicInteger droppedCount = new AtomicInteger(0);

    private volatile boolean running = false;
    private volatile boolean waitingForKeyframe = true;
    private volatile boolean configured = false;
    private volatile boolean intraRefresh = false;

    private int targetWidth = 1920;
    private int targetHeight = 1080;
    private String codecName = "unknown";
    private byte[] lastSps;
    private byte[] lastPps;

    private volatile MediaCodec codec;
    private Thread inputThread;
    private Thread outputThread;

    // Stats
    private volatile int currentFps = 0;
    private volatile int currentDecodeMs = 0;
    private volatile int currentMaxGapMs = 0;
    private long currentSecMaxGapMs = 0;
    private volatile long lastRenderTimeMs = 0;
    private volatile long lastFeedTimeMs = 0;
    private long lastStatsTime = 0;
    private int frameCount = 0;
    private long totalDecodeMs = 0;
    private int sampleCount = 0;

    public NativeVideoDecoder(Surface surface, Listener listener) {
        this.surface = surface;
        this.listener = listener;
    }

    public synchronized void setConfig(int width, int height, boolean intraRefresh) {
        this.intraRefresh = intraRefresh;
        boolean dimensionsChanged = (width > 0 && width != targetWidth) || (height > 0 && height != targetHeight);
        if (width > 0) targetWidth = width;
        if (height > 0) targetHeight = height;

        // CONFIG with the same width/height (stream restart for a bitrate change) must NOT recreate the codec:
        // keep decoding; the new FFmpeg stream starts with an IDR carrying SPS/PPS that MediaCodec accepts in-band.
        // Only recreate when width/height change or the codec errors.
        if (dimensionsChanged || codec == null) {
            configured = false;
            waitingForKeyframe = true;
        }
    }

    public synchronized void setConfig(int width, int height) {
        setConfig(width, height, false);
    }

    public synchronized void start() {
        if (running) return;
        running = true;
        waitingForKeyframe = true;
        lastStatsTime = System.currentTimeMillis();

        inputThread = new Thread(new Runnable() {
            @Override
            public void run() {
                inputLoop();
            }
        }, "sv-decoder-input");

        outputThread = new Thread(new Runnable() {
            @Override
            public void run() {
                outputLoop();
            }
        }, "sv-decoder-output");

        inputThread.start();
        outputThread.start();
        Log.i(TAG, "NativeVideoDecoder started");
    }

    public void feedVideo(byte[] au, boolean keyframe, long arrivalNanos) {
        if (!running || au == null || au.length == 0) return;
        lastFeedTimeMs = System.currentTimeMillis();

        if (waitingForKeyframe) {
            if (!keyframe) {
                droppedCount.incrementAndGet();
                return;
            }
            waitingForKeyframe = false;
        }

        QueuedFrame frame = new QueuedFrame(au, keyframe, arrivalNanos / 1000);
        if (!queue.offer(frame)) {
            if (intraRefresh) {
                // Drop the OLDEST queued frames (keep at most the 2 newest) and continue WITHOUT waitingForKeyframe
                while (queue.size() > 2) {
                    if (queue.poll() != null) {
                        droppedCount.incrementAndGet();
                    }
                }
                if (!queue.offer(frame)) {
                    if (queue.poll() != null) {
                        droppedCount.incrementAndGet();
                    }
                    if (!queue.offer(frame)) {
                        droppedCount.incrementAndGet();
                    }
                }
            } else {
                // Clear and wait for next keyframe
                droppedCount.addAndGet(queue.size() + 1);
                queue.clear();
                waitingForKeyframe = true;
                Log.w(TAG, "Decoder input queue full (" + QUEUE_CAPACITY + ") -> cleared, waiting for keyframe");
            }
        }
    }

    private void inputLoop() {
        while (running) {
            QueuedFrame frame = null;
            try {
                frame = queue.poll(50, TimeUnit.MILLISECONDS);
            } catch (InterruptedException e) {
                break;
            }
            if (frame == null) continue;

            if (!configured || codec == null) {
                if (!frame.keyframe) {
                    if (intraRefresh && lastSps != null && lastPps != null) {
                        initCodec(lastSps, lastPps);
                    } else {
                        droppedCount.incrementAndGet();
                        continue;
                    }
                } else {
                    byte[][] spsPps = extractSpsPps(frame.data);
                    if (spsPps[0] != null) lastSps = spsPps[0];
                    if (spsPps[1] != null) lastPps = spsPps[1];
                    initCodec(spsPps[0] != null ? spsPps[0] : lastSps, spsPps[1] != null ? spsPps[1] : lastPps);
                }
                if (codec == null) {
                    droppedCount.incrementAndGet();
                    continue;
                }
            }

            MediaCodec currentCodec = codec;
            if (currentCodec == null) continue;

            int inIndex = -1;
            int retries = 0;
            while (running && inIndex < 0 && retries < 25) {
                try {
                    inIndex = currentCodec.dequeueInputBuffer(20000);
                    retries++;
                } catch (Throwable e) {
                    Log.w(TAG, "dequeueInputBuffer error, resetting decoder: " + e.getMessage());
                    resetDecoder();
                    break;
                }
            }

            if (!running) break;
            if (inIndex >= 0) {
                try {
                    ByteBuffer inputBuffer;
                    if (Build.VERSION.SDK_INT >= 21) {
                        inputBuffer = currentCodec.getInputBuffer(inIndex);
                    } else {
                        inputBuffer = currentCodec.getInputBuffers()[inIndex];
                    }
                    if (inputBuffer != null) {
                        inputBuffer.clear();
                        inputBuffer.put(frame.data);
                        currentCodec.queueInputBuffer(inIndex, 0, frame.data.length, frame.ptsUs, 0);
                    }
                } catch (Throwable e) {
                    Log.w(TAG, "queueInputBuffer error, resetting decoder: " + e.getMessage());
                    resetDecoder();
                }
            } else {
                droppedCount.incrementAndGet();
            }
        }
    }

    private synchronized void resetDecoder() {
        configured = false;
        waitingForKeyframe = !intraRefresh || lastSps == null || lastPps == null;
        if (codec != null) {
            try { codec.stop(); } catch (Throwable ignored) {}
            try { codec.release(); } catch (Throwable ignored) {}
            codec = null;
        }
    }

    private void outputLoop() {
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        MediaCodec.BufferInfo nextInfo = new MediaCodec.BufferInfo();

        while (running) {
            MediaCodec currentCodec = codec;
            if (currentCodec == null || !configured) {
                try {
                    Thread.sleep(10);
                } catch (InterruptedException e) {
                    break;
                }
                continue;
            }

            int outIndex = -1;
            try {
                outIndex = currentCodec.dequeueOutputBuffer(info, 10000);
            } catch (Throwable e) {
                Log.w(TAG, "dequeueOutputBuffer error, resetting decoder: " + e.getMessage());
                resetDecoder();
                try {
                    Thread.sleep(20);
                } catch (InterruptedException ignored) {}
                continue;
            }

            if (outIndex >= 0) {
                // Low-latency backlog drain: if multiple buffers ready, drop older ones
                int lastIndex = outIndex;
                long lastPtsUs = info.presentationTimeUs;

                int nextIndex;
                try {
                    while ((nextIndex = currentCodec.dequeueOutputBuffer(nextInfo, 0)) >= 0) {
                        currentCodec.releaseOutputBuffer(lastIndex, false);
                        droppedCount.incrementAndGet();
                        lastIndex = nextIndex;
                        lastPtsUs = nextInfo.presentationTimeUs;
                    }
                    currentCodec.releaseOutputBuffer(lastIndex, true);
                    frameCount++;

                    long nowRenderMs = System.currentTimeMillis();
                    if (lastRenderTimeMs > 0) {
                        long gapMs = nowRenderMs - lastRenderTimeMs;
                        if (gapMs > currentSecMaxGapMs) {
                            currentSecMaxGapMs = gapMs;
                        }
                    }
                    lastRenderTimeMs = nowRenderMs;

                    long nowUs = System.nanoTime() / 1000;
                    long latMs = (nowUs - lastPtsUs) / 1000;
                    if (latMs >= 0 && latMs < 5000) {
                        totalDecodeMs += latMs;
                        sampleCount++;
                    }
                } catch (Throwable e) {
                    Log.w(TAG, "releaseOutputBuffer error, resetting decoder: " + e.getMessage());
                    resetDecoder();
                }
            } else if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                try {
                    MediaFormat newFormat = currentCodec.getOutputFormat();
                    Log.i(TAG, "Decoder output format changed: " + newFormat);
                } catch (Throwable ignored) {}
            }

            long nowWatch = System.currentTimeMillis();
            if (configured && lastRenderTimeMs > 0 && lastFeedTimeMs > lastRenderTimeMs + 4000 && nowWatch - lastRenderTimeMs > 4000) {
                Log.w(TAG, "Output stall detected (>4s without rendered frame while receiving video), resetting decoder");
                lastRenderTimeMs = nowWatch;
                resetDecoder();
            }

            // Periodic stats update
            long now = System.currentTimeMillis();
            if (now - lastStatsTime >= 1000) {
                currentFps = (int) Math.round((frameCount * 1000.0) / (now - lastStatsTime));
                currentDecodeMs = sampleCount > 0 ? (int) (totalDecodeMs / sampleCount) : 0;
                currentMaxGapMs = (int) currentSecMaxGapMs;
                currentSecMaxGapMs = 0;
                frameCount = 0;
                totalDecodeMs = 0;
                sampleCount = 0;
                lastStatsTime = now;
            }
        }
    }

    private synchronized void initCodec(byte[] sps, byte[] pps) {
        if (codec != null) {
            try {
                codec.stop();
                codec.release();
            } catch (Throwable ignored) {}
            codec = null;
        }

        int w = targetWidth > 0 ? targetWidth : 1280;
        int h = targetHeight > 0 ? targetHeight : 720;
        MediaFormat format = MediaFormat.createVideoFormat("video/avc", w, h);
        if (sps != null) format.setByteBuffer("csd-0", ByteBuffer.wrap(sps));
        if (pps != null) format.setByteBuffer("csd-1", ByteBuffer.wrap(pps));

        // Low-latency decoder keys
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                format.setInteger(MediaFormat.KEY_LOW_LATENCY, 1);
            } else {
                format.setInteger("low-latency", 1);
            }
        } catch (Throwable ignored) {}
        try { format.setInteger("vendor.low-latency.enable", 1); } catch (Throwable ignored) {}
        try { format.setInteger("vendor.qti-ext-dec-low-latency.enable", 1); } catch (Throwable ignored) {}
        try { format.setInteger("vendor.rtc-ext-dec-low-latency.enable", 1); } catch (Throwable ignored) {}
        try {
            if (Build.VERSION.SDK_INT >= 23) {
                format.setInteger(MediaFormat.KEY_PRIORITY, 0);
            }
        } catch (Throwable ignored) {}
        try {
            format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, Math.max(w * h, 1024 * 1024));
        } catch (Throwable ignored) {}

        MediaCodec newCodec = null;
        String name = null;
        try {
            newCodec = MediaCodec.createDecoderByType("video/avc");
            newCodec.configure(format, surface, null, 0);
            name = newCodec.getName();
            newCodec.start();
        } catch (Throwable e) {
            Log.w(TAG, "Low-latency configure failed, retrying plain configure: " + e.getMessage());
            if (newCodec != null) {
                try { newCodec.release(); } catch (Throwable ignored) {}
                newCodec = null;
            }
            try {
                newCodec = MediaCodec.createDecoderByType("video/avc");
                MediaFormat plain = MediaFormat.createVideoFormat("video/avc", w, h);
                if (sps != null) plain.setByteBuffer("csd-0", ByteBuffer.wrap(sps));
                if (pps != null) plain.setByteBuffer("csd-1", ByteBuffer.wrap(pps));
                newCodec.configure(plain, surface, null, 0);
                name = newCodec.getName();
                newCodec.start();
            } catch (Throwable e2) {
                Log.e(TAG, "Fatal: failed to configure video decoder", e2);
                if (newCodec != null) {
                    try { newCodec.release(); } catch (Throwable ignored) {}
                    newCodec = null;
                }
                return;
            }
        }

        codec = newCodec;
        codecName = name != null ? name : "unknown";
        lastRenderTimeMs = 0;
        configured = true;
        Log.i(TAG, "NativeVideoDecoder ready: " + codecName + " (" + w + "x" + h + ")");

        if (listener != null) {
            listener.onReady(codecName);
        }
    }

    private static byte[][] extractSpsPps(byte[] data) {
        byte[] sps = null;
        byte[] pps = null;
        int len = data.length;
        int i = 0;
        int nalStart = -1;
        int nalHeaderPos = -1;

        while (i < len - 3) {
            boolean prefix4 = (data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 0 && data[i + 3] == 1);
            boolean prefix3 = (!prefix4 && data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 1);
            if (prefix4 || prefix3) {
                int prefixLen = prefix4 ? 4 : 3;
                if (nalStart >= 0 && nalHeaderPos >= 0) {
                    int nalType = data[nalHeaderPos] & 0x1f;
                    byte[] nal = new byte[i - nalStart];
                    System.arraycopy(data, nalStart, nal, 0, i - nalStart);
                    if (nalType == 7 && sps == null) sps = nal;
                    else if (nalType == 8 && pps == null) pps = nal;
                }
                nalStart = i;
                nalHeaderPos = i + prefixLen;
                i += prefixLen;
            } else {
                i++;
            }
        }
        if (nalStart >= 0 && nalHeaderPos >= 0 && nalHeaderPos < len) {
            int nalType = data[nalHeaderPos] & 0x1f;
            byte[] nal = new byte[len - nalStart];
            System.arraycopy(data, nalStart, nal, 0, len - nalStart);
            if (nalType == 7 && sps == null) sps = nal;
            else if (nalType == 8 && pps == null) pps = nal;
        }
        return new byte[][] { sps, pps };
    }

    public synchronized void release() {
        running = false;
        if (inputThread != null) {
            inputThread.interrupt();
        }
        if (outputThread != null) {
            outputThread.interrupt();
        }
        try {
            if (inputThread != null) inputThread.join(400);
            if (outputThread != null) outputThread.join(400);
        } catch (InterruptedException ignored) {}

        inputThread = null;
        outputThread = null;
        queue.clear();

        if (codec != null) {
            try {
                codec.stop();
            } catch (Throwable ignored) {}
            try {
                codec.release();
            } catch (Throwable ignored) {}
            codec = null;
        }
        configured = false;
        waitingForKeyframe = true;
        lastRenderTimeMs = 0;
        lastFeedTimeMs = 0;
    }

    public int getFps() {
        return currentFps;
    }

    public int getDecodeMs() {
        return currentDecodeMs;
    }

    public int getMaxGapMs() {
        return currentMaxGapMs;
    }

    public int getQueueSize() {
        return queue.size();
    }

    public int getDropped() {
        return droppedCount.get();
    }

    public String getCodecName() {
        return codecName;
    }

    public int getWidth() {
        return targetWidth;
    }

    public int getHeight() {
        return targetHeight;
    }
}
