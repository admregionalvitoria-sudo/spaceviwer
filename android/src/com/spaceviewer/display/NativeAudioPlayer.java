package com.spaceviewer.display;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.os.Build;
import android.util.Log;

/**
 * Low-latency PCM audio playback via AudioTrack.
 * Receives 48 kHz stereo 16-bit PCM (4 bytes/frame).
 * Drops backlog if pending frames exceed ~120 ms.
 */
public final class NativeAudioPlayer {
    private static final String TAG = "SVNativeAudio";
    private static final int SAMPLE_RATE = 48000;
    private static final int BYTES_PER_FRAME = 4; // 2 channels * 2 bytes
    private static final int MAX_PENDING_FRAMES = (SAMPLE_RATE * 120) / 1000; // 5760 frames (~120ms)

    private AudioTrack track;
    private long totalFramesWritten = 0;
    private boolean started = false;

    public synchronized void start() {
        if (track != null) return;
        try {
            int minBuf = AudioTrack.getMinBufferSize(
                SAMPLE_RATE,
                AudioFormat.CHANNEL_OUT_STEREO,
                AudioFormat.ENCODING_PCM_16BIT
            );
            int bufSize = Math.max(minBuf, (SAMPLE_RATE * BYTES_PER_FRAME * 40) / 1000);

            AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build();

            AudioFormat format = new AudioFormat.Builder()
                .setSampleRate(SAMPLE_RATE)
                .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .build();

            AudioTrack.Builder builder = new AudioTrack.Builder()
                .setAudioAttributes(attrs)
                .setAudioFormat(format)
                .setBufferSizeInBytes(bufSize)
                .setTransferMode(AudioTrack.MODE_STREAM);

            if (Build.VERSION.SDK_INT >= 26) {
                builder.setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY);
            }

            track = builder.build();
            totalFramesWritten = 0;
            started = false;
            Log.i(TAG, "NativeAudioPlayer initialized (bufSize=" + bufSize + ")");
        } catch (Exception e) {
            Log.e(TAG, "Failed to initialize AudioTrack", e);
            track = null;
        }
    }

    public synchronized void playChunk(byte[] pcm) {
        if (pcm == null || pcm.length == 0) return;
        if (track == null) {
            start();
        }
        if (track == null) return;

        try {
            if (!started) {
                track.play();
                started = true;
            }

            // Backlog check: compare written frames vs playback head position
            long headPos = track.getPlaybackHeadPosition() & 0xffffffffL;
            long pendingFrames = totalFramesWritten - headPos;
            if (pendingFrames > MAX_PENDING_FRAMES) {
                Log.w(TAG, "Audio backlog detected (" + pendingFrames + " frames), flushing");
                track.pause();
                track.flush();
                track.play();
                totalFramesWritten = track.getPlaybackHeadPosition() & 0xffffffffL;
            }

            int written;
            if (Build.VERSION.SDK_INT >= 23) {
                written = track.write(pcm, 0, pcm.length, AudioTrack.WRITE_NON_BLOCKING);
            } else {
                written = track.write(pcm, 0, pcm.length);
            }

            if (written > 0) {
                totalFramesWritten += (written / BYTES_PER_FRAME);
            }
        } catch (Exception e) {
            Log.w(TAG, "Error playing audio chunk: " + e.getMessage());
        }
    }

    public synchronized void release() {
        if (track != null) {
            try {
                if (track.getPlayState() == AudioTrack.PLAYSTATE_PLAYING) {
                    track.stop();
                }
                track.release();
            } catch (Exception ignored) {}
            track = null;
        }
        started = false;
        totalFramesWritten = 0;
    }
}
