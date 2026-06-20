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
  var forceResumeTimer = null;
  var FORCE_RESUME_INTERVAL_MS = 400;

  // createMediaElementSource() may only be called ONCE per media element for the
  // lifetime of the AudioContext; calling it again throws. Cache the source node
  // per element so analyser rebuilds (track changes, compressor toggles) reuse it.
  // Unlike captureStream(), a MediaElementSource removes the element's audio from
  // the default output, so it MUST be routed to audioContext.destination or the
  // user hears nothing. We therefore always connect a passthrough to destination.
  var elementSourceMap = new WeakMap();
  var passthroughToDestination = null;

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
    // NOTE: never disconnect/null the cached MediaElementSource's path to destination
    // here. That path is the only one carrying the element's audio to the speakers and
    // the source cannot be recreated. We only detach + tear down the analyser branch.
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

  // Return a cached MediaElementSource for the element, creating it at most once.
  // Also wires a guaranteed passthrough to destination so audible output never drops.
  // Returns null if the element cannot be used as a source.
  function getElementSource(mediaElement) {
    var existing = elementSourceMap.get(mediaElement);
    if (existing) return existing;
    if (typeof audioContext.createMediaElementSource !== "function") return null;
    try {
      var node = audioContext.createMediaElementSource(mediaElement);
      elementSourceMap.set(mediaElement, node);
      if (!passthroughToDestination) {
        passthroughToDestination = audioContext.createGain();
        passthroughToDestination.gain.value = 1.0;
        passthroughToDestination.connect(audioContext.destination);
      }
      node.connect(passthroughToDestination);
      return node;
    } catch (e) {
      return null;
    }
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

    // Use a cached MediaElementSource instead of captureStream(). captureStream()
    // could intermittently take over the element's audio output once the context
    // actually resumed (leaving playback near-silent) and produced unreliable FFT.
    // MediaElementSource is deterministic: the analyser is tapped off it and a
    // guaranteed passthrough routes audio to destination so sound always plays.
    var elementSource = getElementSource(mediaElement);
    if (!elementSource) return false;

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
      sourceNode = elementSource;
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
        // The analyser branch is a dead end (never connected to destination), so the
        // compressor + makeup gain here only shape the signal feeding the FFT/WLED
        // analysis -- never the audible output, which comes solely from the
        // source -> passthrough -> destination path.
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
