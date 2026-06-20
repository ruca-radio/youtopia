(function() {
  if (window.__YTMD_AUDIO_ANALYZER__) {
    return;
  }

  let audioContext = null;
  let sourceNode = null;
  let analyzerNode = null;
  let animationId = null;
  let currentMediaElement = null;
  let isRunning = false;

  function getMediaElement() {
    const playerBar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
    if (playerBar && playerBar.playerApi && playerBar.playerApi.getPlayerNode) {
      const node = playerBar.playerApi.getPlayerNode();
      if (node && (node.tagName === "VIDEO" || node.tagName === "AUDIO")) {
        return node;
      }
    }

    return document.querySelector("video") || document.querySelector("audio");
  }

  function disconnectAnalyzer() {
    if (sourceNode) {
      try {
        sourceNode.disconnect();
      } catch {}
      sourceNode = null;
    }

    if (analyzerNode) {
      try {
        analyzerNode.disconnect();
      } catch {}
      analyzerNode = null;
    }

    currentMediaElement = null;
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

  function connectAnalyzer() {
    const mediaElement = getMediaElement();
    if (!mediaElement) return false;
    if (mediaElement === currentMediaElement && analyzerNode) return true;

    disconnectAnalyzer();

    const stream = getCapturedStream(mediaElement);
    if (!stream) return false;

    try {
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }

      if (audioContext.state === "suspended") {
        audioContext.resume().catch(() => {});
      }

      sourceNode = audioContext.createMediaStreamSource(stream);
      analyzerNode = audioContext.createAnalyser();
      analyzerNode.fftSize = 64;
      analyzerNode.smoothingTimeConstant = 0.75;
      analyzerNode.minDecibels = -90;
      analyzerNode.maxDecibels = -10;
      sourceNode.connect(analyzerNode);
      currentMediaElement = mediaElement;
      return true;
    } catch (error) {
      disconnectAnalyzer();
      return false;
    }
  }

  function sendFrequencyData() {
    if (!isRunning) return;

    if (connectAnalyzer() && analyzerNode) {
      if (audioContext && audioContext.state === "suspended") {
        audioContext.resume().catch(() => {});
      }
      const data = new Uint8Array(analyzerNode.frequencyBinCount);
      analyzerNode.getByteFrequencyData(data);
      window.ytmd.sendAudioData(Array.from(data));
    }

    animationId = requestAnimationFrame(sendFrequencyData);
  }

  function start() {
    if (isRunning) return;
    isRunning = true;

    if (audioContext && audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }

    sendFrequencyData();
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
})
