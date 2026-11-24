package com.spaceviewer.display;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.util.Log;

import org.json.JSONObject;

/** Publishes _svdisplay._tcp so the PC can also find the device through mDNS. */
public final class NsdRegistrar {
    private static final String TAG = "SVNsd";
    private static final String SERVICE_TYPE = "_svdisplay._tcp";

    private final NsdManager manager;
    private final DeviceInfoProvider info;
    private NsdManager.RegistrationListener listener;

    public NsdRegistrar(Context context, DeviceInfoProvider info) {
        this.manager = (NsdManager) context.getApplicationContext().getSystemService(Context.NSD_SERVICE);
        this.info = info;
    }

    public synchronized void start() {
        if (manager == null || listener != null) return;
        try {
            JSONObject json = info.toJson();
            NsdServiceInfo service = new NsdServiceInfo();
            service.setServiceName("SpaceViewer " + json.optString("name", "Display"));
            service.setServiceType(SERVICE_TYPE);
            service.setPort(DeviceInfoProvider.CONTROL_PORT);
            service.setAttribute("id", info.getId());
            service.setAttribute("name", json.optString("name"));
            service.setAttribute("model", json.optString("model"));
            service.setAttribute("w", String.valueOf(json.optInt("width")));
            service.setAttribute("h", String.valueOf(json.optInt("height")));
            listener = new NsdManager.RegistrationListener() {
                @Override public void onServiceRegistered(NsdServiceInfo s) { Log.i(TAG, "registered " + s.getServiceName()); }
                @Override public void onRegistrationFailed(NsdServiceInfo s, int code) { Log.w(TAG, "registration failed " + code); }
                @Override public void onServiceUnregistered(NsdServiceInfo s) { }
                @Override public void onUnregistrationFailed(NsdServiceInfo s, int code) { }
            };
            manager.registerService(service, NsdManager.PROTOCOL_DNS_SD, listener);
        } catch (Exception e) {
            Log.w(TAG, "nsd start", e);
            listener = null;
        }
    }

    public synchronized void stop() {
        if (manager == null || listener == null) return;
        try { manager.unregisterService(listener); } catch (Exception ignored) { }
        listener = null;
    }
}
