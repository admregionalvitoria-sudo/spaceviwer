// SpaceViewer Display — receiver (answerer side of the PC <-> APK protocol, docs/ARQUITETURA-TELA-ESTENDIDA.md §3.3)
(function () {
  'use strict';

  var bridge = window.SpaceViewerAndroid || null;
  var $ = function (id) { return document.getElementById(id); };
  var video = $('video');

  var info = readInfo();
  var conn = null;          // last /connect request
  var ws = null;
  var pc = null;
  var pendingCandidates = [];
  var config = null;        // last stream-config
  var stopRequested = false;
  var reconnectUntil = 0;
  var reconnectTimer = null;
  var statsTimer = null;
  var pingTimer = null;
  var toastTimer = null;
  var lastStats = null;
  var latencyMs = 0;
  var audioUnlockHandler = null;
  var lastPongAt = 0;
  var lastRecoverSentAt = 0;
  var recoverTimeout = null;
  var iceDisconnectTimer = null;
  var progressState = { seen: false, bytes: 0, framesDecoded: 0, framesReceived: 0, stalledTicks: 0, pauseTicks: 0, zeroBytesTicks: 0 };

  function clearAudioUnlock() {
    if (audioUnlockHandler) {
      document.removeEventListener('touchend', audioUnlockHandler);
      document.removeEventListener('click', audioUnlockHandler);
      audioUnlockHandler = null;
    }
  }

  function clearRecoverTimers() {
    clearTimeout(recoverTimeout);
    recoverTimeout = null;
    clearTimeout(iceDisconnectTimer);
    iceDisconnectTimer = null;
  }

  function resetProgress() {
    progressState = { seen: false, bytes: 0, framesDecoded: 0, framesReceived: 0, stalledTicks: 0, pauseTicks: 0, zeroBytesTicks: 0 };
  }

  function safePlayVideo() {
    var playPromise = video.play();
    if (playPromise && playPromise.catch) {
      playPromise.catch(function (err) {
        console.warn('video.play failed, retrying muted:', err);
        video.muted = true;
        var mutedPromise = video.play();
        if (mutedPromise && mutedPromise.catch) mutedPromise.catch(function () {});
      });
    }
  }

  function handleAudioStream() {
    if (config && config.audio === false) {
      video.muted = true;
      return;
    }
    var stream = video.srcObject;
    var hasAudio = stream && stream.getAudioTracks && stream.getAudioTracks().length > 0;
    if (!hasAudio) return;

    video.muted = false;
    var playPromise = video.play();
    if (playPromise && playPromise.catch) {
      playPromise.catch(function (err) {
        console.warn('unmuted play failed (autoplay policy):', err);
        video.muted = true;
        var fallbackPlay = video.play();
        if (fallbackPlay && fallbackPlay.catch) fallbackPlay.catch(function () {});
        toast('Toque na tela para ativar o som', 5000);
        if (!audioUnlockHandler) {
          audioUnlockHandler = function () {
            clearAudioUnlock();
            if (config && config.audio === false) return;
            video.muted = false;
            var p = video.play();
            if (p && p.catch) p.catch(function () {});
          };
          document.addEventListener('touchend', audioUnlockHandler);
          document.addEventListener('click', audioUnlockHandler);
        }
      });
    }
  }

  function readInfo() {
    try { if (bridge) return JSON.parse(bridge.getInfo()); } catch (e) { console.warn('getInfo failed', e); }
    return {
      id: 'browser-' + Math.random().toString(16).slice(2), name: 'Navegador', model: navigator.userAgent,
      ip: location.hostname || '—', controlPort: 47811,
      width: Math.max(screen.width, screen.height), height: Math.min(screen.width, screen.height), refreshRate: 60
    };
  }

  function setState(state, status) {
    document.body.setAttribute('data-state', state);
    if (status) $('status').textContent = status;
    try { if (bridge) bridge.setState(state, conn ? (conn.masterName || conn.host) : ''); } catch (e) { /* ignore */ }
  }

  function renderInfo() {
    $('device-name').textContent = info.name || info.model || 'Android';
    var ips = (info.ips && info.ips.length ? info.ips : [info.ip]).filter(Boolean);
    $('ip').textContent = ips[0] || 'Sem rede';
    $('ip-extra').textContent = ips.length > 1 ? 'Também: ' + ips.slice(1).join(', ') : (ips.length ? '' : 'Conecte este aparelho à mesma rede Wi-Fi do PC');
    $('port').textContent = String(info.controlPort || 47811);
    $('resolution').textContent = info.width + '×' + info.height + (info.refreshRate ? ' · ' + info.refreshRate + ' Hz' : '');
    $('footer').textContent = (info.manufacturer ? info.manufacturer + ' ' : '') + (info.model || '') +
      (info.android ? ' · Android ' + info.android : '') + (info.appVersion ? ' · v' + info.appVersion : '');
  }

  function toast(text, ms) {
    var el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, ms || 3000);
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  // ---------- WebSocket session ----------
  function connect() {
    clearTimeout(reconnectTimer);
    closeSocket();
    if (!conn) return;
    setState('connecting', 'Conectando a ' + (conn.masterName || conn.host) + '…');
    var url = 'ws://' + conn.host + ':' + conn.port + '/?role=display' +
      '&deviceId=' + encodeURIComponent(info.id) + '&sessionId=' + encodeURIComponent(conn.sessionId);
    var socket = new WebSocket(url);
    ws = socket;

    socket.onopen = function () {
      if (ws !== socket) return;
      lastPongAt = Date.now();
      send({ type: 'agent-info', payload: {
        kind: 'display', deviceId: info.id, sessionId: conn.sessionId, name: info.name, os: 'android',
        model: info.model, resolution: { width: info.width, height: info.height }, refreshRate: info.refreshRate
      } });
      startTimers();
    };

    socket.onmessage = function (event) {
      if (ws !== socket) return;
      var msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      handle(msg).catch(function (err) { console.error('handle failed', err); });
    };

    socket.onclose = function () {
      if (ws !== socket) return;
      ws = null;
      stopTimers();
      closePeer();
      if (stopRequested || !conn) { goIdle(); return; }
      if (!reconnectUntil) reconnectUntil = Date.now() + 60000;
      if (Date.now() < reconnectUntil) {
        setState('connecting', 'Conexão perdida. Reconectando…');
        reconnectTimer = setTimeout(connect, 2000);
      } else {
        conn = null;
        goIdle();
      }
    };

    socket.onerror = function () { /* onclose handles retry */ };
  }

  function closeSocket() {
    clearRecoverTimers();
    if (ws) {
      var old = ws;
      ws = null;
      try { old.close(); } catch (e) { /* ignore */ }
    }
    stopTimers();
  }

  function goIdle() {
    clearRecoverTimers();
    closePeer();
    clearAudioUnlock();
    video.muted = true;
    reconnectUntil = 0;
    video.srcObject = null;
    $('stats').hidden = true;
    info = readInfo();
    renderInfo();
    setState('idle', 'Aguardando o computador…');
  }

  async function handle(msg) {
    var payload = msg.payload || {};
    switch (msg.type) {
      case 'auth-response':
        if (payload.status === 'ok') {
          reconnectUntil = 0;
          if (document.body.getAttribute('data-state') !== 'streaming') {
            setState('connecting', 'Conectado a ' + (conn.masterName || conn.host) + ' — aguardando vídeo…');
          }
        }
        break;
      case 'stream-config':
        config = payload;
        if (payload.audio === false) {
          video.muted = true;
          clearAudioUnlock();
        } else if (payload.audio === true) {
          handleAudioStream();
        }
        if (payload.orientation && bridge) { try { bridge.setOrientation(payload.orientation); } catch (e) { /* ignore */ } }
        if (payload.label) toast(payload.label + (payload.width ? ' · ' + payload.width + '×' + payload.height : '') + (payload.fps ? ' @ ' + payload.fps + ' fps' : ''));
        break;
      case 'webrtc-offer':
        clearRecoverTimers();
        await answerOffer(payload);
        break;
      case 'ice-candidate':
        addCandidate(payload);
        break;
      case 'stream-stop':
        clearRecoverTimers();
        if (payload.reason === 'reconfigure') {
          closePeer();
          setState('connecting', 'Aplicando nova configuração…');
        } else {
          stopRequested = true;
          conn = null;
          closeSocket();
          goIdle();
        }
        break;
      case 'pong':
        lastPongAt = Date.now();
        if (typeof msg.payload === 'number' && lastPingSent) latencyMs = Date.now() - lastPingSent;
        break;
    }
  }

  function requestWebRtcRecover(reason) {
    if (stopRequested || !conn || conn.transport === 'native') return;
    var now = Date.now();
    if (now - lastRecoverSentAt < 5000) return;
    lastRecoverSentAt = now;
    console.warn('Requesting WebRTC recovery:', reason);
    closePeer();
    setState('connecting', 'Reconectando vídeo…');
    if (ws && ws.readyState === WebSocket.OPEN) {
      send({ type: 'webrtc-recover', payload: { reason: reason } });
      clearTimeout(recoverTimeout);
      recoverTimeout = setTimeout(function () {
        recoverTimeout = null;
        if (!stopRequested && conn && !pc) {
          console.warn('No offer after webrtc-recover, reconnecting WebSocket');
          closeSocket();
          connect();
        }
      }, 6000);
    } else {
      connect();
    }
  }

  // ---------- WebRTC (answerer) ----------
  async function answerOffer(offer) {
    closePeer();
    resetProgress();
    var peer = new RTCPeerConnection({ iceServers: [] });
    pc = peer;

    peer.ontrack = function (event) {
      if (pc !== peer) return;
      try {
        if ('playoutDelayHint' in event.receiver) event.receiver.playoutDelayHint = 0;
        if ('jitterBufferTarget' in event.receiver) event.receiver.jitterBufferTarget = 0;
      } catch (e) { /* not supported */ }
      var stream = event.streams && event.streams[0] ? event.streams[0] : (video.srcObject || new MediaStream());
      if (stream.addTrack && (!stream.getTracks || stream.getTracks().indexOf(event.track) === -1)) {
        try { stream.addTrack(event.track); } catch (e) { /* ignore */ }
      }
      if (video.srcObject !== stream) video.srcObject = stream;
      safePlayVideo();

      if (event.track.kind === 'audio' || (stream.getAudioTracks && stream.getAudioTracks().length > 0)) {
        handleAudioStream();
      }
    };

    peer.onicecandidate = function (event) {
      if (pc !== peer || !event.candidate) return;
      send({ type: 'ice-candidate', payload: { type: 'candidate', candidate: {
        candidate: event.candidate.candidate, sdpMLineIndex: event.candidate.sdpMLineIndex, sdpMid: event.candidate.sdpMid
      } } });
    };

    peer.ondatachannel = function (event) { event.channel.onmessage = function () {}; };

    function handlePeerState() {
      if (pc !== peer) return;
      var state = peer.connectionState || peer.iceConnectionState;
      var ice = peer.iceConnectionState;
      if (state === 'connected' || ice === 'connected' || ice === 'completed') {
        clearTimeout(iceDisconnectTimer);
        iceDisconnectTimer = null;
      } else if (state === 'failed' || ice === 'failed') {
        clearTimeout(iceDisconnectTimer);
        iceDisconnectTimer = null;
        requestWebRtcRecover('peer-' + (state === 'failed' ? 'failed' : 'ice-failed'));
      } else if (state === 'disconnected' || ice === 'disconnected') {
        if (!iceDisconnectTimer) {
          iceDisconnectTimer = setTimeout(function () {
            iceDisconnectTimer = null;
            if (pc !== peer) return;
            var cur = peer.connectionState || peer.iceConnectionState;
            if (cur === 'disconnected' || peer.iceConnectionState === 'disconnected') {
              requestWebRtcRecover('ice-disconnected');
            }
          }, 4000);
        }
      }
    }

    peer.onconnectionstatechange = handlePeerState;
    peer.oniceconnectionstatechange = handlePeerState;

    await peer.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
    var queued = pendingCandidates;
    pendingCandidates = [];
    queued.forEach(function (c) { peer.addIceCandidate(c).catch(function () {}); });
    var answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    if (pc !== peer) return;
    send({ type: 'webrtc-answer', payload: { type: 'answer', sdp: peer.localDescription.sdp } });
  }

  function addCandidate(payload) {
    var c = payload && payload.candidate;
    if (!c || !c.candidate) return;
    if (!pc || !pc.remoteDescription) { pendingCandidates.push(c); return; }
    pc.addIceCandidate(c).catch(function (e) { console.warn('addIceCandidate', e); });
  }

  function closePeer() {
    clearAudioUnlock();
    clearTimeout(iceDisconnectTimer);
    iceDisconnectTimer = null;
    pendingCandidates = [];
    lastStats = null;
    resetProgress();
    if (pc) {
      var old = pc;
      pc = null;
      try { old.close(); } catch (e) { /* ignore */ }
    }
  }

  video.addEventListener('playing', function () {
    reconnectUntil = 0;
    clearRecoverTimers();
    setState('streaming');
  });

  video.addEventListener('pause', function () {
    if (pc && !stopRequested && document.body.getAttribute('data-state') === 'streaming') {
      safePlayVideo();
    }
  });

  video.addEventListener('ended', function () {
    if (pc && !stopRequested) {
      requestWebRtcRecover('video-ended');
    }
  });

  // ---------- Stats / keepalive ----------
  var lastPingSent = 0;
  function startTimers() {
    stopTimers();
    lastPongAt = Date.now();
    pingTimer = setInterval(function () {
      if (lastPongAt && Date.now() - lastPongAt > 10000) {
        console.warn('WebSocket pong timeout, reconnecting');
        if (ws) { try { ws.close(); } catch (e) { /* ignore */ } }
        return;
      }
      lastPingSent = Date.now();
      send({ type: 'ping', payload: lastPingSent });
    }, 3000);
    statsTimer = setInterval(collectStats, 2000);
  }

  function stopTimers() {
    clearInterval(pingTimer);
    clearInterval(statsTimer);
    pingTimer = statsTimer = null;
  }

  async function collectStats() {
    if (!pc) return;
    var activePeer = pc;
    var stream = video.srcObject;
    if (stream && stream.getVideoTracks) {
      var vTracks = stream.getVideoTracks();
      if (vTracks.length > 0 && vTracks[0].readyState === 'ended') {
        requestWebRtcRecover('track-ended');
        return;
      }
    }
    if (document.body.getAttribute('data-state') === 'streaming' && video.paused) {
      safePlayVideo();
      progressState.pauseTicks++;
      if (progressState.pauseTicks >= 2) {
        requestWebRtcRecover('video-paused');
        return;
      }
    } else {
      progressState.pauseTicks = 0;
    }

    var report;
    try { report = await activePeer.getStats(); } catch (e) { return; }
    if (pc !== activePeer) return;
    var inbound = null;
    report.forEach(function (r) { if (r.type === 'inbound-rtp' && (r.kind === 'video' || r.mediaType === 'video')) inbound = r; });
    if (!inbound) return;
    var now = inbound.timestamp;
    var bytes = inbound.bytesReceived || 0;
    var framesDecoded = inbound.framesDecoded || 0;
    var framesReceived = inbound.framesReceived || 0;

    if (progressState.seen) {
      var receivingMedia = bytes > progressState.bytes || framesReceived > progressState.framesReceived;
      if (receivingMedia && framesDecoded > 0 && framesDecoded === progressState.framesDecoded) {
        progressState.stalledTicks++;
        if (progressState.stalledTicks >= 3) {
          requestWebRtcRecover('decoder-stalled');
          return;
        }
      } else if (framesDecoded > progressState.framesDecoded) {
        progressState.stalledTicks = 0;
      }

      if (bytes === progressState.bytes && document.body.getAttribute('data-state') === 'streaming' && (activePeer.connectionState !== 'connected' || video.readyState < 2)) {
        progressState.zeroBytesTicks++;
        if (progressState.zeroBytesTicks >= 4) {
          requestWebRtcRecover('stream-stalled');
          return;
        }
      } else if (bytes > progressState.bytes) {
        progressState.zeroBytesTicks = 0;
      }
    }
    progressState.seen = true;
    progressState.bytes = bytes;
    progressState.framesDecoded = framesDecoded;
    progressState.framesReceived = framesReceived;

    var mbps = 0;
    if (lastStats && now > lastStats.timestamp) mbps = ((bytes - lastStats.bytes) * 8) / ((now - lastStats.timestamp) * 1000);
    lastStats = { timestamp: now, bytes: bytes };
    var bufferMs = (inbound.jitterBufferEmittedCount && inbound.jitterBufferEmittedCount > 0 && typeof inbound.jitterBufferDelay === 'number')
      ? Math.round((inbound.jitterBufferDelay / inbound.jitterBufferEmittedCount) * 1000)
      : 0;
    var payload = {
      fps: Math.round(inbound.framesPerSecond || 0),
      width: inbound.frameWidth || 0,
      height: inbound.frameHeight || 0,
      jitterMs: Math.round((inbound.jitter || 0) * 1000),
      bufferMs: bufferMs,
      framesDropped: inbound.framesDropped || 0,
      packetsLost: inbound.packetsLost || 0,
      mbps: Math.round(mbps * 10) / 10,
      rttMs: latencyMs,
      decoder: inbound.decoderImplementation || ''
    };
    send({ type: 'display-stats', payload: payload });
    $('stats').textContent =
      (config && config.label ? config.label + '\n' : '') +
      payload.width + '×' + payload.height + ' @ ' + payload.fps + ' fps\n' +
      payload.mbps + ' Mbps · jitter ' + payload.jitterMs + ' ms · buffer ' + bufferMs + ' ms · rtt ' + latencyMs + ' ms\n' +
      'perdidos ' + payload.packetsLost + ' · descartados ' + payload.framesDropped +
      (payload.decoder ? '\ndecoder ' + payload.decoder : '');
  }

  // Double tap toggles the stats overlay.
  var lastTap = 0;
  document.addEventListener('touchend', function () {
    var now = Date.now();
    if (now - lastTap < 320) toggleStats();
    lastTap = now;
  });
  document.addEventListener('dblclick', toggleStats);
  function toggleStats() {
    if (document.body.getAttribute('data-state') !== 'streaming') return;
    $('stats').hidden = !$('stats').hidden;
  }

  // ---------- Native bridge entry points ----------
  window.SpaceViewer = {
    onConnect: function (request) {
      conn = typeof request === 'string' ? JSON.parse(request) : request;
      stopRequested = false;
      reconnectUntil = 0;
      config = null;
      if (conn.orientation && bridge) { try { bridge.setOrientation(conn.orientation); } catch (e) { /* ignore */ } }
      if (conn.transport === 'native') {
        var name = conn.masterName || conn.host || 'o computador';
        setState('connecting', 'Conectando a ' + name + ' (tempo real)…');
        return;
      }
      connect();
    },
    onDisconnect: function () {
      stopRequested = true;
      conn = null;
      clearTimeout(reconnectTimer);
      closeSocket();
      goIdle();
    },
    onNativeState: function (state, info) {
      if (state === 'streaming') {
        setState('streaming-native');
      } else if (state === 'idle') {
        goIdle();
      }
    },
    onInfo: function (next) {
      info = typeof next === 'string' ? JSON.parse(next) : next;
      renderInfo();
    }
  };

  // Keep the IP current while waiting (Wi-Fi may change).
  setInterval(function () {
    if (document.body.getAttribute('data-state') === 'idle') { info = readInfo(); renderInfo(); }
  }, 3000);

  renderInfo();
  setState('idle', 'Aguardando o computador…');
})();
