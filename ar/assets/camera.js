export function hasCameraSupport() {
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

export function needsHttps() {
  return !window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1";
}
