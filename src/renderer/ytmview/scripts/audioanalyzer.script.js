(function() {
  if (window.__YTMD_AUDIO_ANALYZER__) {
    return;
  }

  // Create the AudioContext lazily once a user activation occurs, preventing
  // console autoplay policy warnings on page load while keeping WLED and TV
  // visualizers functional as soon as the UI receives input or begins playing.
  var audioContext = null;
  var resumePromise = null;

  var hasActivation = typeof navigator !== "undefined" && navigator.userActivation && navigator.userActivation.hasBeenActive;
  if (hasActivation) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === "suspended") {
      resumePromise = audioContext.resume().catch(function() {
        resumePromise = null;
      });
    }
  }

  var resumeOnInteraction = function() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
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
  var forceResumeTimer = null;
  var FORCE_RESUME_INTERVAL_MS = 400;

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
    // The analyzer graph is capture-stream only and is never connected to
    // destination, so tearing it down cannot mute or reduce playback volume.
    if (sourceNode) {
      try {
        if (compressorNode) sourceNode.disconnect(compressorNode);
        else if (analyzerNode) sourceNode.disconnect(analyzerNode);
      } catch (e) {}
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
    var hasActivation = typeof navigator !== "undefined" && navigator.userActivation && navigator.userActivation.hasBeenActive;
    if (hasActivation && !audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext && audioContext.state === "suspended") {
      if (hasActivation && !resumePromise) {
        resumePromise = audioContext.resume().then(function() {
          resumePromise = null;
        }).catch(function() {
          resumePromise = null;
        });
      }
    }
    return resumePromise || Promise.resolve();
  }

  // Autoplay policy can leave the AudioContext suspended until a user gesture occurs
  // inside the ytmView. When that happens the analyser emits all-zero FFT frames and
  // the TV VU meter falls back to its static placeholder bars. While the analyzer is
  // meant to be running, keep attempting to resume the context on a short timer so it
  // recovers on its own (e.g. as soon as playback or any qualifying event occurs)
  // without requiring the user to interact with the desktop window.
  function startForceResumeLoop() {
    if (forceResumeTimer) return;
    forceResumeTimer = setInterval(function() {
      if (!isRunning) {
        stopForceResumeLoop();
        return;
      }
      if (audioContext && audioContext.state === "suspended") {
        ensureRunning();
      }
    }, FORCE_RESUME_INTERVAL_MS);
  }

  function stopForceResumeLoop() {
    if (forceResumeTimer) {
      clearInterval(forceResumeTimer);
      forceResumeTimer = null;
    }
  }

  function connectAnalyzer() {
    var mediaElement = getMediaElement();
    if (!mediaElement) return false;

    var needsRebuild = false;
    if (compressorSettings.enabled && !compressorNode) needsRebuild = true;
    if (!compressorSettings.enabled && compressorNode) needsRebuild = true;

    if (mediaElement === currentMediaElement && analyzerNode && !needsRebuild) return true;

    disconnectAnalyzer();

    // Sample the element with captureStream() so Web Audio never owns the audible
    // output path. createMediaElementSource() reroutes the media element through
    // the AudioContext and has regressed playback volume/output before; this graph
    // is analyzer-only and is intentionally never connected to destination.
    var mediaStream = getCapturedStream(mediaElement);
    if (!mediaStream) return false;

    var hasActivation = typeof navigator !== "undefined" && navigator.userActivation && navigator.userActivation.hasBeenActive;
    if (hasActivation && !audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (!audioContext || typeof audioContext.createMediaStreamSource !== "function") return false;

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
      sourceNode = audioContext.createMediaStreamSource(mediaStream);
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
        // FM-style makeup gain: this shapes only the FFT/WLED analysis branch, not
        // audible playback volume, because the capture-stream graph is a dead end
        // and is never connected to audioContext.destination.
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
    // Always attempt a resume on start(), even if already running. The hub may
    // re-assert "start" specifically to unstick a context that was created or left
    // in a suspended state (autoplay policy), so an early return must not skip the
    // resume attempt.
    ensureRunning();
    startForceResumeLoop();
    if (isRunning) return;
    isRunning = true;
    ensureRunning().then(function() {
      sendFrequencyData();
    });
  }

  function stop() {
    isRunning = false;
    stopForceResumeLoop();
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    disconnectAnalyzer();
  }

  window.__YTMD_AUDIO_ANALYZER__ = { start, stop };
  window.__YTMD_AUDIO_ANALYZER__.updateCompressorSettings = updateCompressorSettings;
})
