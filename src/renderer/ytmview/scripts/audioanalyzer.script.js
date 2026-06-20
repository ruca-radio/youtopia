(function() {
  if (window.__YTMD_AUDIO_ANALYZER__) {
    return;
  }

  // Create the AudioContext immediately while the load event's user activation
  // is still fresh. Electron's autoplay-policy flag only covers media elements,
  // not Web Audio API — without this eager creation + resume, the analyser
  // produces all-zero FFT data and the TV VU meter stays dead.
  var audioContext = new (window.AudioContext || window.webkitAudioContext)();
  var resumePromise = null;
  if (audioContext.state === "suspended") {
    resumePromise = audioContext.resume().catch(function() {
      resumePromise = null;
    });
  }

  var resumeOnInteraction = function() {
    if (audioContext && audioContext.state === "suspended") {
      audioContext.resume();
    }
  };
  document.addEventListener("click", resumeOnInteraction, { once: true });
  document.addEventListener("keydown", resumeOnInteraction, { once: true });
  document.addEventListener("mousedown", resumeOnInteraction, { once: true });

  var sourceNode = null;
  var compressorNode = null;
  var makeupGainNode = null;
  var analyzerNode = null;
  var animationId = null;
  var currentMediaElement = null;
  var isRunning = false;
  var zeroFrameCount = 0;
  var ZERO_FRAME_REBUILD_THRESHOLD = 30;

  var compressorSettings = {
    enabled: true,
    threshold: -24,
    ratio: 12,
    attack: 0.003,
    release: 0.25
  };

  function updateCompressorSettings(settings) {
    if (!settings) return;
    var enabledChanged = settings.enabled !== undefined && settings.enabled !== compressorSettings.enabled;
    compressorSettings = Object.assign(compressorSettings, settings);

    if (compressorNode && audioContext) {
      try {
        if (compressorSettings.threshold !== undefined) compressorNode.threshold.setValueAtTime(compressorSettings.threshold, audioContext.currentTime);
        if (compressorSettings.ratio !== undefined) compressorNode.ratio.setValueAtTime(compressorSettings.ratio, audioContext.currentTime);
        if (compressorSettings.attack !== undefined) compressorNode.attack.setValueAtTime(compressorSettings.attack, audioContext.currentTime);
        if (compressorSettings.release !== undefined) compressorNode.release.setValueAtTime(compressorSettings.release, audioContext.currentTime);
      } catch (e) {
        console.error("Failed to update compressor params:", e);
      }
    }

    if (enabledChanged && isRunning && currentMediaElement) {
      connectAnalyzer();
    }
  }

  function getMediaElement() {
    var playerBar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
    if (playerBar && playerBar.playerApi && playerBar.playerApi.getPlayerNode) {
      var node = playerBar.playerApi.getPlayerNode();
      if (node && (node.tagName === "VIDEO" || node.tagName === "AUDIO")) {
        return node;
      }
    }
    return document.querySelector("video") || document.querySelector("audio");
  }

  function disconnectAnalyzer() {
    if (sourceNode) {
      try { sourceNode.disconnect(); } catch (e) {}
      sourceNode = null;
    }
    if (compressorNode) {
      try { compressorNode.disconnect(); } catch (e) {}
      compressorNode = null;
    }
    if (makeupGainNode) {
      try { makeupGainNode.disconnect(); } catch (e) {}
      makeupGainNode = null;
    }
    if (analyzerNode) {
      try { analyzerNode.disconnect(); } catch (e) {}
      analyzerNode = null;
    }
    currentMediaElement = null;
    zeroFrameCount = 0;
  }

  function getCapturedStream(mediaElement) {
    if (typeof mediaElement.captureStream === "function") {
      return mediaElement.captureStream();
    }
    if (typeof mediaElement.mozCaptureStream === "function") {
      return mediaElement.mozCaptureStream();
    }
    return null;
  }

  function ensureRunning() {
    if (audioContext.state === "suspended") {
      if (!resumePromise) {
        resumePromise = audioContext.resume().then(function() {
          resumePromise = null;
        }).catch(function() {
          resumePromise = null;
        });
      }
    }
    return resumePromise || Promise.resolve();
  }

  function connectAnalyzer() {
    var mediaElement = getMediaElement();
    if (!mediaElement) return false;

    var needsRebuild = false;
    if (compressorSettings.enabled && !compressorNode) needsRebuild = true;
    if (!compressorSettings.enabled && compressorNode) needsRebuild = true;

    if (mediaElement === currentMediaElement && analyzerNode && !needsRebuild) return true;

    disconnectAnalyzer();

    var stream = getCapturedStream(mediaElement);
    if (!stream) return false;

    // Attach listeners to the media element to resume context on playback events
    var onPlayEvent = function() {
      if (audioContext && audioContext.state === "suspended") {
        audioContext.resume();
      }
    };
    ["play", "playing", "timeupdate"].forEach(function(evt) {
      mediaElement.removeEventListener(evt, onPlayEvent);
      mediaElement.addEventListener(evt, onPlayEvent);
    });

    try {
      sourceNode = audioContext.createMediaStreamSource(stream);
      analyzerNode = audioContext.createAnalyser();
      analyzerNode.fftSize = 64;
      analyzerNode.smoothingTimeConstant = 0.75;
      analyzerNode.minDecibels = -90;
      analyzerNode.maxDecibels = -10;

      if (compressorSettings.enabled) {
        compressorNode = audioContext.createDynamicsCompressor();
        compressorNode.threshold.setValueAtTime(compressorSettings.threshold, audioContext.currentTime);
        compressorNode.ratio.setValueAtTime(compressorSettings.ratio, audioContext.currentTime);
        compressorNode.attack.setValueAtTime(compressorSettings.attack, audioContext.currentTime);
        compressorNode.release.setValueAtTime(compressorSettings.release, audioContext.currentTime);
        // FM-style makeup gain after compression keeps the analyzer/WLED signal dense
        // without routing processed audio back to the user's speakers.
        makeupGainNode = audioContext.createGain();
        makeupGainNode.gain.setValueAtTime(1.65, audioContext.currentTime);

        sourceNode.connect(compressorNode);
        compressorNode.connect(makeupGainNode);
        makeupGainNode.connect(analyzerNode);
      } else {
        sourceNode.connect(analyzerNode);
      }

      currentMediaElement = mediaElement;
      return true;
    } catch (e) {
      disconnectAnalyzer();
      return false;
    }
  }

  function sendFrequencyData() {
    if (!isRunning) return;

    ensureRunning().then(function() {
      if (connectAnalyzer() && analyzerNode) {
        var data = new Uint8Array(analyzerNode.frequencyBinCount);
        analyzerNode.getByteFrequencyData(data);
        var sum = 0;
        for (var i = 0; i < data.length; i++) {
          sum += data[i];
        }
        var mediaElement = currentMediaElement || getMediaElement();
        var playingWithTime = mediaElement && !mediaElement.paused && !mediaElement.ended && mediaElement.currentTime > 0;
        if (sum === 0 && playingWithTime) {
          zeroFrameCount += 1;
          if (zeroFrameCount >= ZERO_FRAME_REBUILD_THRESHOLD) {
            disconnectAnalyzer();
            zeroFrameCount = 0;
          }
        } else if (sum > 0) {
          zeroFrameCount = 0;
        }
        window.ytmd.sendAudioData(Array.from(data));
      }
    });

    animationId = requestAnimationFrame(sendFrequencyData);
  }

  function start() {
    if (isRunning) return;
    isRunning = true;
    ensureRunning().then(function() {
      sendFrequencyData();
    });
  }

  function stop() {
    isRunning = false;
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    disconnectAnalyzer();
  }

  window.__YTMD_AUDIO_ANALYZER__ = { start, stop };
  window.__YTMD_AUDIO_ANALYZER__.updateCompressorSettings = updateCompressorSettings;
})
