import * as THREE from "./three.js?v=20260529-no-access-v1";
import { getAllCardTargets, getCardTarget, markerResourceMap } from "./cards.js?v=20260529-no-access-v1";
import { createEmptyAnchor } from "./anchor.js?v=20260529-no-access-v1";
import { hasCameraSupport, needsHttps } from "./camera.js?v=20260529-no-access-v1";
import { detectCardPoseFromFrame, trackCardPoseFromFrame } from "./tracker.js?v=20260529-no-access-v1";

const $ = (selector) => document.querySelector(selector);

const PRESETS = {
  SYNTH: { color: 0x3aa6ff, mode: "synth" },
  GUITAR: { color: 0x39e59f, mode: "guitar" },
  DRUM: { color: 0xffa23a, mode: "drum" },
  BASS: { color: 0xb26bff, mode: "bass" }
};

const WAVES = {
  SAW: { color: 0x3aa6ff, osc: "sawtooth" },
  SQUARE: { color: 0xb26bff, osc: "square" },
  SINE: { color: 0x39e59f, osc: "sine" }
};

const FADERS = [
  { id: "A", label: "A", value: 0.05, color: 0x3aa6ff },
  { id: "D", label: "D", value: 0.28, color: 0x3aa6ff },
  { id: "S", label: "S", value: 0.62, color: 0x3aa6ff },
  { id: "R", label: "R", value: 0.30, color: 0x3aa6ff },
  { id: "FX", label: "FX", value: 0.22, color: 0xb26bff },
  { id: "VOL", label: "VOL", value: 0.82, color: 0x39e59f }
];

const PERFORMANCE_BUTTONS = ["GLIDE", "ARP", "HOLD"];
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const WHITE_PCS = new Set([0, 2, 4, 5, 7, 9, 11]);
const BUILD_ID = "20260529-no-access-v1";
const REQUIRED_CARD_ID = "hechengqi";
const PROMPT_FIND_CARD = "请将乐器识别卡放入画面中";
const MARKER_SCAN_INTERVAL = 0;
const MARKER_LOST_TIMEOUT_MS = 500;
const PATTERN_SWITCH_MARGIN = 0.035;
const BLUE_CARD_THRESHOLD = 0.03;
const REQUIRED_IMAGE_TRACK_CORNERS = 4;
const MIN_IMAGE_TRACK_CORNER_RATIO = 0.18;
const MIN_IMAGE_TRACK_CONFIDENCE = 0.62;
const REQUIRED_FOUND_FRAMES = 1;
const MARKER_CANDIDATE_RESET_MS = 420;
const MIN_SYNTH_NOTE_HOLD_MS = 230;
const MIN_BASS_NOTE_HOLD_MS = 280;
const FIXED_SYNTH_SCALE = 2.5;
const MARKER_REFERENCE_SIZE = 0.36;
const MARKER_REFERENCE_DISTANCE = 6.1;
const MARKER_MIN_DISTANCE = 2.35;
const MARKER_MAX_DISTANCE = 12.5;
const USER_SCALE_LIMITS = {
  min: 0.85,
  max: 3.4
};
const ORIGINAL_GUITAR_PARAMS = {
  style: "folk",
  attack: 0.002,
  decay: 0.05,
  sustain: 0.62,
  release: 2.2,
  cutoff: 0.48,
  brightness: 0.9982,
  drive: 1.0,
  body: 0.52,
  reverb: 0.24,
  chorus: 0.06,
  vibrato: 0.02,
  stringType: "steel"
};
const GUITAR_CONTROL_DEFAULTS = {
  cutoff: 0.62,
  fx: 0.22
};
const GUITE222_GUITAR_WORKLET_URL = new URL(`./guitar-worklet.js?v=${BUILD_ID}`, import.meta.url);
const GUITE222_GUITAR_PARAMS = {
  attack: 0.002,
  decay: 0.06,
  sustain: 0.55,
  release: 2.5,
  cutoff: 0.45,
  brightness: 0.9985
};
const GUITE222_BASE_FREQ = 82.41;
const GUITE222_BASE_MIDI = 48;
const DRUM_CONTROLS = {
  tone: 0.62,
  decay: 0.52,
  drive: 0.25,
  space: 0.35,
  level: 0.82
};

const synthMarkerBinding = markerResourceMap.hechengqi;
const drumMarkerBinding = markerResourceMap.drum;
window.markerResourceMap = markerResourceMap;
window.activeInstrument = null;

const state = {
  currentMode: "synth",
  currentPreset: "SYNTH",
  currentWave: "SAW",
  octaveShift: 0,
  cutoff: 0.62,
  reso: 0.28,
  pitchBend: 0,
  mod: 0,
  glide: false,
  arp: false,
  hold: false,
  faders: Object.fromEntries(FADERS.map((item) => [item.id, item.value])),
  marker: {
    locked: false,
    payload: "",
    cardId: REQUIRED_CARD_ID,
    instrumentType: null,
    lastSeenAt: 0,
    poseMatrix: null,
    centerX: 0.5,
    centerY: 0.52,
    size: 0.24,
    angle: 0,
    tiltX: 0,
    tiltY: 0
  },
  lastFreq: null
};

const ui = {
  presetButtons: new Map(),
  waveButtons: new Map(),
  perfButtons: new Map(),
  keys: new Map(),
  faders: new Map(),
  knobs: new Map(),
  strips: new Map()
};

let cameraStream = null;
let cameraStarting = false;
let markerFrame = 0;
let lastScanAt = 0;
let scanCanvas = null;
let scanCtx = null;
let scene = null;
let camera = null;
let renderer = null;
let synthGroup = null;
let drumGroup = null;
let activeModelGroup = null;
let screenMaterial = null;
let drumScreenMaterial = null;
let raycaster = null;
let pointer = null;
let anchor = createEmptyAnchor();
let lastCardPoseScan = null;
let foundFrameCount = 0;
let lastCandidateAt = 0;
let interactives = [];
let activePointers = new Map();
let activeTouchPoints = new Map();
let transformGesture = null;
let userTransform = {
  scale: 1
};
let dragState = null;
let audioCtx = null;
let audioUnlocked = false;
let masterGain = null;
let fxSend = null;
let delayNode = null;
let delayFeedback = null;
let guitarReverbSend = null;
let guitarReverbConvolver = null;
let guitarReverbGain = null;
let guite222GuitarNode = null;
let guite222GuitarReady = null;
let guite222GuitarFailed = false;
let activeVoices = new Map();
let canvasBound = false;
let drumControls = { ...DRUM_CONTROLS };
let drumControlMeshes = new Map();
let patternTargetsReady = null;
const arDebugState = {
  BUILD_ID,
  markerFound: false,
  poseFound: false,
  pattWinner: "none",
  blueRatio: "0.0000",
  classifiedIdentity: "none",
  finalIdentity: "none",
  shownModel: "none",
  "drumModel.visible": false,
  "synthModel.visible": false,
  poseUpdated: false
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpAngle(a, b, t) {
  const diff = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + diff * t;
}

function pointerDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function makeMaterial({ color, emissive = 0x000000, roughness = 0.62, metalness = 0.1, transparent = false, opacity = 1 }) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: emissive ? 0.4 : 0,
    roughness,
    metalness,
    transparent,
    opacity
  });
}

function labelTexture(lines, options = {}) {
  const width = options.width || 256;
  const height = options.height || 96;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  if (options.background) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = options.color || "#f6fff8";
  const list = Array.isArray(lines) ? lines : [lines];
  const fontSize = options.fontSize || (list.length > 1 ? 26 : 34);
  ctx.font = `800 ${fontSize}px Arial, PingFang SC, Microsoft YaHei, sans-serif`;
  const step = height / (list.length + 1);
  list.forEach((line, index) => {
    ctx.fillText(line, width / 2, step * (index + 1));
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addLabel(parent, text, x, y, z, w, h, options = {}) {
  const mat = new THREE.MeshBasicMaterial({
    map: labelTexture(text, options),
    transparent: true,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function setPrompt(text) {
  const prompt = $("#stage-prompt");
  if (prompt) prompt.textContent = text;
}

function setStageWaiting(waiting) {
  $("#ar-stage")?.classList.toggle("awaiting-camera", waiting);
}

function setSynthActive(active) {
  $("#ar-stage")?.classList.toggle("mode-play", active);
}

function setActiveInstrumentModel(instrumentType) {
  activeModelGroup = instrumentType === "drum-machine"
    ? drumGroup
    : instrumentType === "synthesizer"
      ? synthGroup
      : null;
  if (synthGroup) synthGroup.visible = false;
  if (drumGroup) drumGroup.visible = false;
}

function resetUserTransform() {
  userTransform = {
    scale: 1
  };
  transformGesture = null;
  activeTouchPoints.clear();
}

function ensurePatternTargetsLoaded() {
  if (patternTargetsReady) return patternTargetsReady;
  patternTargetsReady = Promise.all(getAllCardTargets().map(async (target) => {
    const url = target.markerResource?.markerUrl;
    if (!url) return target;
    const response = await fetch(withBuildVersion(url), { cache: "no-store" });
    if (!response.ok) throw new Error(`Cannot load marker pattern: ${url}`);
    const text = await response.text();
    const rotations = parsePattRotations(text);
    if (!rotations.length) throw new Error(`Invalid marker pattern: ${url}`);
    target.patternSignature = {
      minConfidence: target.patternMatch?.minConfidence,
      rotations
    };
    console.info(`[AR pattern] loaded: ${target.id}`, {
      instrument: target.instrumentId,
      url,
      rotations: rotations.length,
      minConfidence: target.patternSignature.minConfidence
    });
    return target;
  })).catch((err) => {
    console.error("[AR pattern] load failed", err);
    patternTargetsReady = null;
    throw err;
  });
  return patternTargetsReady;
}

function withBuildVersion(url) {
  const resolved = new URL(url, window.location.href);
  resolved.searchParams.set("v", BUILD_ID);
  return resolved.href;
}

function parsePattRotations(text) {
  const values = String(text).trim().split(/\s+/).map(Number).filter(Number.isFinite);
  if (values.length < 16 * 16 * 3) return [];
  const rotations = [];
  let index = 0;
  for (let rotation = 0; rotation < 4 && index + 16 * 16 * 3 <= values.length; rotation += 1) {
    const channels = [];
    for (let channel = 0; channel < 3; channel += 1) {
      channels.push(values.slice(index, index + 16 * 16));
      index += 16 * 16;
    }
    rotations.push(channels[0].map((_, cell) => (
      channels[0][cell] + channels[1][cell] + channels[2][cell]
    ) / 3));
  }
  return rotations;
}

function showWelcome() {
  document.body.classList.add("welcome-active");
  $("#welcome-screen")?.classList.remove("hidden");
}

function hideWelcome() {
  document.body.classList.remove("welcome-active");
  $("#welcome-screen")?.classList.add("hidden");
}

function ensureAudio() {
  if (audioCtx) return audioCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) {
    setPrompt("当前浏览器不支持 Web Audio");
    return null;
  }

  audioCtx = new Ctx({ latencyHint: "interactive" });
  if (navigator.audioSession) {
    try { navigator.audioSession.type = "playback"; } catch (err) {}
  }

  masterGain = audioCtx.createGain();
  masterGain.gain.value = state.faders.VOL;

  const compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 22;
  compressor.ratio.value = 5;
  compressor.attack.value = 0.006;
  compressor.release.value = 0.18;
  masterGain.connect(compressor);
  compressor.connect(audioCtx.destination);

  fxSend = audioCtx.createGain();
  fxSend.gain.value = state.faders.FX * 0.34;
  delayNode = audioCtx.createDelay(0.9);
  delayNode.delayTime.value = 0.22;
  delayFeedback = audioCtx.createGain();
  delayFeedback.gain.value = 0.18;
  fxSend.connect(delayNode);
  delayNode.connect(delayFeedback);
  delayFeedback.connect(delayNode);
  delayNode.connect(compressor);

  guitarReverbSend = audioCtx.createGain();
  guitarReverbConvolver = audioCtx.createConvolver();
  guitarReverbGain = audioCtx.createGain();
  guitarReverbConvolver.buffer = createImpulseResponse(audioCtx, 1.45, 2.4);
  guitarReverbGain.gain.value = getOriginalGuitarParams().reverb * 0.36;
  guitarReverbSend.connect(guitarReverbConvolver);
  guitarReverbConvolver.connect(guitarReverbGain);
  guitarReverbGain.connect(masterGain);
  queueGuite222GuitarWorkletLoad();
  return audioCtx;
}

function createImpulseResponse(ctx, duration, decay) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * 0.35;
    }
  }
  return buffer;
}

function unlockAudio() {
  const ctx = ensureAudio();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => setPrompt("请再次点击启动声音"));
    }
    if (audioUnlocked) return;
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
    audioUnlocked = true;
  } catch (err) {}
}

function resetAudioForPreset(id) {
  const ctx = ensureAudio();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  cancelActiveControlPointers();
  state.lastFreq = null;
  const now = ctx.currentTime;
  masterGain?.gain.cancelScheduledValues(now);
  masterGain?.gain.setTargetAtTime(state.faders.VOL, now, 0.015);
  fxSend?.gain.cancelScheduledValues(now);
  fxSend?.gain.setTargetAtTime(state.faders.FX * 0.34, now, 0.015);
  if (guitarReverbGain) {
    const reverb = id === "GUITAR" ? getOriginalGuitarParams().reverb * 0.36 : 0;
    guitarReverbGain.gain.cancelScheduledValues(now);
    guitarReverbGain.gain.setTargetAtTime(reverb, now, 0.02);
  }
}

function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69 + state.pitchBend * 2) / 12);
}

function getAdsr() {
  return {
    attack: 0.004 + state.faders.A * 0.72,
    decay: 0.035 + state.faders.D * 0.9,
    sustain: clamp(state.faders.S, 0.08, 0.92),
    release: 0.04 + state.faders.R * 1.8
  };
}

function makeNoiseBuffer(ctx, duration = 0.7) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function applyVoiceEnvelope(gain, velocity, sustainMultiplier = 1) {
  const ctx = audioCtx;
  const adsr = getAdsr();
  const now = ctx.currentTime;
  const peak = clamp(velocity * state.faders.VOL, 0.001, 0.95);
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(peak, now + adsr.attack);
  gain.gain.setTargetAtTime(peak * adsr.sustain * sustainMultiplier, now + adsr.attack, adsr.decay / 3);
}

function routeVoice(source, filter, gain) {
  source.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  gain.connect(fxSend);
}

function createSynthVoice(midi, velocity = 0.78, options = {}) {
  const ctx = ensureAudio();
  if (!ctx) return null;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  const now = ctx.currentTime;
  const freq = midiToFrequency(midi + (options.bass ? -12 : 0));
  const wave = options.wave || WAVES[state.currentWave].osc;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 180 + Math.pow(state.cutoff, 1.4) * (options.bass ? 3600 : 11800);
  filter.Q.value = 0.7 + state.reso * 12;

  const gain = ctx.createGain();
  gain.gain.value = 0.0001;

  let source;
  let oscillator = null;
  if (wave === "noise") {
    source = ctx.createBufferSource();
    source.buffer = makeNoiseBuffer(ctx, 1.4);
  } else {
    source = ctx.createOscillator();
    oscillator = source;
    source.type = wave;
    if (state.glide && state.lastFreq) {
      source.frequency.setValueAtTime(state.lastFreq, now);
      source.frequency.exponentialRampToValueAtTime(Math.max(20, freq), now + 0.11);
    } else {
      source.frequency.value = freq;
    }
    source.detune.value = state.pitchBend * 200;
    if (state.mod > 0.02) {
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 4.5 + state.mod * 5;
      lfoGain.gain.value = state.mod * (options.bass ? 10 : 24);
      lfo.connect(lfoGain);
      lfoGain.connect(source.detune);
      lfo.start(now);
      window.setTimeout(() => {
        try { lfo.stop(); lfo.disconnect(); lfoGain.disconnect(); } catch (err) {}
      }, 2600);
    }
  }

  applyVoiceEnvelope(gain, velocity, options.bass ? 0.8 : 1);
  routeVoice(source, filter, gain);
  source.start(now);

  const voice = {
    source,
    oscillator,
    gain,
    filter,
    startedAt: now,
    minHoldUntil: now + ((options.bass ? MIN_BASS_NOTE_HOLD_MS : MIN_SYNTH_NOTE_HOLD_MS) / 1000),
    released: false,
    releaseTimer: 0
  };
  state.lastFreq = freq;
  return voice;
}

function noteNameToMidi(note = "C4") {
  if (typeof note === "number" && Number.isFinite(note)) return note;
  const match = String(note).trim().match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
  if (!match) return 60;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase()];
  const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  const octave = Number(match[3]);
  return (octave + 1) * 12 + base + accidental;
}

async function initSynthesizer() {
  unlockAudio();
  if (!PRESETS[state.currentPreset]) {
    selectPreset("SYNTH");
    return true;
  }
  updateDisplay(
    state.currentPreset === "DRUM" ? "DRUM KIT" : state.currentPreset,
    state.currentMode === "synth" || state.currentMode === "bass" ? state.currentWave : "PRESET",
    "READY"
  );
  return true;
}

async function initDrumMachine() {
  unlockAudio();
  updateDrumDisplay("QR DRUM", "128 BPM", "READY");
  return true;
}

async function playSynthesizerNote(options = {}) {
  if (!window.activeInstrument) return null;
  unlockAudio();
  const midi = noteNameToMidi(options.note || "C4");
  const velocity = clamp(Number(options.velocity ?? 0.8), 0.05, 1);
  const duration = clamp(Number(options.duration ?? 0.6), 0.08, 4);
  const voice = createSynthVoice(midi, velocity);
  if (voice) window.setTimeout(() => releaseVoice(voice), duration * 1000);
  return voice;
}

async function playDrumMachinePad(options = {}) {
  unlockAudio();
  const id = options.pad || options.id || "kick";
  playDrum(id, clamp(Number(options.velocity ?? 0.88), 0.05, 1));
  return null;
}

function activateInstrumentMarker(details = {}) {
  const config = details.markerResource || synthMarkerBinding;
  const alreadyActive = window.activeInstrument?.cardId === config.cardId;
  if (window.activeInstrument?.cardId !== config.cardId) {
    const isDrum = config.instrumentType === "drum-machine";
    console.info(`markerFound: ${config.cardId}`, {
      instrument: config.instrumentType,
      source: details.source,
      recognizedText: details.recognizedText
    });
    window.activeInstrument = {
      ...config,
      initAudioEngine: isDrum ? initDrumMachine : initSynthesizer,
      play: isDrum ? playDrumMachinePad : playSynthesizerNote
    };
    document.body.classList.add("synthesizer-active");
  }
  setActiveInstrumentModel(config.instrumentType);
  if (!alreadyActive) window.activeInstrument.initAudioEngine?.();
  updateArDebug({
    finalIdentity: config.cardId === "drum" ? "drum" : "synth",
    shownModel: config.cardId === "drum" ? "drum" : "synth"
  });
}

function deactivateInstrumentMarker() {
  if (window.activeInstrument) {
    console.info(`markerLost: ${window.activeInstrument.cardId}`, {
      instrument: window.activeInstrument.instrumentType
    });
    window.activeInstrument = null;
  }
  setActiveInstrumentModel(null);
  document.body.classList.remove("synthesizer-active");
  updateArDebug({
    finalIdentity: "none",
    shownModel: "none",
    "drumModel.visible": false,
    "synthModel.visible": false
  });
}

function releaseVoice(voice, options = {}) {
  if (!voice || !audioCtx || voice.released) return;
  const now = audioCtx.currentTime;
  const wait = options.force ? 0 : Math.max(0, (voice.minHoldUntil || now) - now);
  if (wait <= 0.005) {
    noteOff(voice, options);
    return;
  }
  if (voice.releaseTimer) return;
  voice.releaseTimer = window.setTimeout(() => {
    voice.releaseTimer = 0;
    noteOff(voice, options);
  }, wait * 1000);
}

function noteOff(voice, options = {}) {
  if (!voice || !audioCtx) return;
  if (voice.released) return;
  voice.released = true;
  if (voice.releaseTimer) {
    window.clearTimeout(voice.releaseTimer);
    voice.releaseTimer = 0;
  }
  const adsr = getAdsr();
  const now = audioCtx.currentTime;
  const release = options.force ? 0.035 : (state.hold ? Math.max(adsr.release, 1.0) : adsr.release);
  try {
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0.0001, now, release / 4);
    voice.source.stop(now + release + 0.08);
  } catch (err) {}
  window.setTimeout(() => {
    try {
      voice.source.disconnect();
      voice.filter.disconnect();
      voice.gain.disconnect();
    } catch (err) {}
  }, (release + 0.2) * 1000);
}

function createPluckVoice(midi, velocity = 0.78) {
  playGuite222GuitarNote(midi, velocity);
  return null;
}

function queueGuite222GuitarWorkletLoad() {
  if (!audioCtx || guite222GuitarNode || guite222GuitarReady || guite222GuitarFailed) return guite222GuitarReady;
  if (!audioCtx.audioWorklet || typeof AudioWorkletNode === "undefined") {
    guite222GuitarFailed = true;
    return null;
  }

  guite222GuitarReady = audioCtx.audioWorklet
    .addModule(GUITE222_GUITAR_WORKLET_URL.href)
    .then(() => {
      guite222GuitarNode = new AudioWorkletNode(audioCtx, "guitar-processor");
      guite222GuitarNode.connect(audioCtx.destination);
      return guite222GuitarNode;
    })
    .catch((err) => {
      guite222GuitarFailed = true;
      console.warn("guite222 guitar worklet failed", err);
      return null;
    });

  return guite222GuitarReady;
}

function playGuite222GuitarNote(midi, velocity = 0.85) {
  const ctx = ensureAudio();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});

  const freq = guite222FrequencyForMidi(midi);
  const message = {
    type: "pluck",
    freq,
    velocity: 0.85,
    params: getGuite222GuitarParams()
  };

  if (guite222GuitarNode) {
    guite222GuitarNode.port.postMessage(message);
    return;
  }

  const ready = queueGuite222GuitarWorkletLoad();
  if (ready) {
    ready.then((node) => {
      if (node) node.port.postMessage(message);
      else playGuite222FallbackNote(freq, velocity);
    });
    return;
  }

  playGuite222FallbackNote(freq, velocity);
}

function getGuite222GuitarParams() {
  return { ...GUITE222_GUITAR_PARAMS };
}

function guite222FrequencyForMidi(midi) {
  return GUITE222_BASE_FREQ * Math.pow(2, (midi - GUITE222_BASE_MIDI) / 12);
}

function playGuite222FallbackNote(freq, velocity = 0.85) {
  const ctx = ensureAudio();
  if (!ctx || !freq) return;
  const params = getGuite222GuitarParams();
  const buffer = synthesizeGuite222FallbackBuffer(ctx, freq, velocity, params);
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  source.buffer = buffer;
  gain.gain.value = 0.9;
  source.connect(gain);
  gain.connect(ctx.destination);
  source.start(now);
  source.stop(now + buffer.duration);
}

function synthesizeGuite222FallbackBuffer(ctx, freq, velocity, params) {
  const sampleRate = ctx.sampleRate;
  const size = clamp(Math.round(sampleRate / freq), 8, 2400);
  const duration = 3.5;
  const length = Math.max(size + 2, Math.floor(sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const out = buffer.getChannelData(0);
  const delay = new Float32Array(size);

  for (let i = 0; i < size; i++) {
    let n = (Math.random() * 2 - 1) * velocity;
    if (i > 1) n = delay[i - 2] * 0.15 + delay[i - 1] * 0.55 + n * 0.30;
    delay[i] = n;
  }

  let pos = 0;
  let amp = 0;
  let phase = "attack";
  let lp1 = 0;
  const dt = 1 / sampleRate;
  for (let i = 0; i < length; i++) {
    let env = 0;
    if (phase === "attack") {
      amp += dt / params.attack;
      if (amp >= 1) {
        amp = 1;
        phase = "decay";
      }
      env = amp;
    } else if (phase === "decay") {
      amp -= dt / params.decay * (1 - params.sustain);
      if (amp <= params.sustain) {
        amp = params.sustain;
        phase = "sustain";
      }
      env = amp;
    } else {
      env = params.sustain;
    }

    const next = (pos + 1) % size;
    let ks = (delay[pos] + delay[next]) * 0.5 * params.brightness;
    lp1 += params.cutoff * (ks - lp1);
    delay[pos] = lp1;
    pos = next;
    out[i] = Math.tanh(lp1 * env * 0.45);
  }

  return buffer;
}

function playOriginalGuitarNote(midi, velocity = 0.78) {
  const ctx = ensureAudio();
  if (!ctx) return null;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const freq = midiToFrequency(midi);
  const params = getOriginalGuitarParams();
  const buffer = synthesizeOriginalGuitarBuffer(ctx, freq, velocity, params);
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = clamp(900 + params.cutoff * 5200 + params.body * 700, 650, 7600);
  filter.Q.value = 0.65 + params.body * 1.1;

  const gain = ctx.createGain();
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  const now = ctx.currentTime;
  const release = Math.max(0.08, params.release * 0.32);
  const peak = clamp(velocity, 0.05, 0.95);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), now + Math.max(0.002, params.attack));
  gain.gain.setTargetAtTime(peak * params.sustain, now + params.attack + params.decay, Math.max(0.025, params.decay));
  gain.gain.setTargetAtTime(0.0001, now + 0.22 + params.decay, release);

  const lane = guitarLaneForMidi(midi);
  if (pan) pan.pan.value = (lane - 2.5) / 4.2;

  source.connect(filter);
  if (pan) {
    filter.connect(pan);
    pan.connect(gain);
  } else {
    filter.connect(gain);
  }
  gain.connect(masterGain);
  if (guitarReverbSend) gain.connect(guitarReverbSend);
  if (guitarReverbGain) guitarReverbGain.gain.setTargetAtTime(params.reverb * 0.36, now, 0.03);

  source.start(now);
  source.stop(now + buffer.duration + 0.05);
  source.onended = () => {
    try {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      pan?.disconnect();
    } catch (err) {}
  };

  const chorusAmount = params.chorus + (state.mod > 0.02 ? state.mod * 0.10 : 0);
  if (chorusAmount > 0.03) {
    window.setTimeout(() => {
      const detune = Math.pow(2, ((Math.random() > 0.5 ? 7 : -7) * chorusAmount) / 1200);
      playOriginalGuitarGhost(freq * detune, velocity * chorusAmount * 0.32, lane);
    }, 16);
  }

  return null;
}

function playOriginalGuitarGhost(freq, velocity, lane) {
  const ctx = ensureAudio();
  if (!ctx || !freq) return;
  const params = getOriginalGuitarParams();
  const buffer = synthesizeOriginalGuitarBuffer(ctx, freq, velocity, params, { short: true });
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  const now = ctx.currentTime;

  gain.gain.setValueAtTime(clamp(velocity, 0.001, 0.45), now);
  gain.gain.setTargetAtTime(0.0001, now + 0.05, 0.22);
  if (pan) pan.pan.value = (lane - 2.5) / 3.6;

  if (pan) {
    source.connect(pan);
    pan.connect(gain);
  } else {
    source.connect(gain);
  }
  gain.connect(masterGain);
  source.start(now);
  source.stop(now + buffer.duration);
}

function getOriginalGuitarParams() {
  const cutoffRatio = clamp(state.cutoff / GUITAR_CONTROL_DEFAULTS.cutoff, 0.45, 1.45);
  const fxRatio = GUITAR_CONTROL_DEFAULTS.fx > 0
    ? clamp(state.faders.FX / GUITAR_CONTROL_DEFAULTS.fx, 0, 2.4)
    : 1;
  return {
    ...ORIGINAL_GUITAR_PARAMS,
    cutoff: clamp(ORIGINAL_GUITAR_PARAMS.cutoff * cutoffRatio, 0.18, 0.92),
    release: state.hold ? ORIGINAL_GUITAR_PARAMS.release * 1.28 : ORIGINAL_GUITAR_PARAMS.release,
    reverb: clamp(ORIGINAL_GUITAR_PARAMS.reverb * fxRatio, 0, 0.82),
    chorus: clamp(ORIGINAL_GUITAR_PARAMS.chorus + state.mod * 0.10, 0, 0.34),
    vibrato: clamp(ORIGINAL_GUITAR_PARAMS.vibrato + state.mod * 0.06, 0, 0.18)
  };
}

function synthesizeOriginalGuitarBuffer(ctx, freq, velocity, p, options = {}) {
  const sampleRate = ctx.sampleRate;
  const period = clamp(Math.round(sampleRate / freq), 8, 2400);
  const duration = options.short ? 0.9 : clamp(1.7 + p.release * 0.48, 1.4, 4.4);
  const len = Math.max(period + 4, Math.floor(sampleRate * duration));
  const data = new Float32Array(len);
  const stringFactor = p.stringType === "nylon" ? 0.72 : 1.0;
  const noiseAmp = 0.58 * velocity * stringFactor;

  for (let i = 0; i < period; i++) {
    let n = (Math.random() * 2 - 1) * noiseAmp;
    if (["folk", "classical", "bossa", "ambient"].includes(p.style) && i > 1) {
      n = data[i - 2] * 0.16 + data[i - 1] * 0.52 + n * 0.32;
    }
    if (["metal", "funk"].includes(p.style)) {
      n = Math.sign(n) * Math.min(Math.abs(n * 3.5), 1) * 0.82;
    }
    data[i] = n;
  }

  let lp1 = 0;
  let lp2 = 0;
  let hp1 = 0;
  const decay = p.brightness;
  const cutoff = p.cutoff;
  const blend = cutoff * 0.45 + 0.28;
  const vibDepth = p.vibrato * 0.004;

  for (let i = period; i < len; i++) {
    const vib = vibDepth ? Math.round(Math.sin((i / sampleRate) * Math.PI * 2 * 5.8) * vibDepth * period) : 0;
    const read = clamp(i - period + vib, 0, i - 1);
    const next = clamp(read + 1, 0, i - 1);
    let ks = (data[read] * blend + data[next] * (1 - blend)) * decay;

    switch (p.style) {
      case "classical":
        lp1 += 0.22 * (ks - lp1);
        lp2 += 0.35 * (lp1 - lp2);
        ks = lp2;
        break;
      case "jazz":
        lp1 += 0.20 * (ks - lp1);
        lp2 += 0.30 * (lp1 - lp2);
        ks = lp2 * (1 + Math.sin(i / sampleRate * 3.1) * 0.012);
        break;
      case "blues":
        lp1 += 0.40 * (ks - lp1);
        lp2 += 0.15 * (lp1 - lp2);
        ks = softDrive(lp1 * 2.5, 2.0) * 0.65 + lp2 * 0.35;
        break;
      case "country":
        lp1 += 0.75 * (ks - lp1);
        ks = lp1 * 0.45 + (lp1 - lp2) * 0.55;
        lp2 = lp1;
        break;
      case "funk":
        lp1 += 0.60 * (ks - lp1);
        ks = softDrive(lp1 * 2.2, 1.8);
        break;
      case "metal":
        lp1 += 0.85 * (ks - lp1);
        ks = Math.max(-0.7, Math.min(0.7, lp1 * p.drive));
        hp1 = 0.9 * (hp1 + ks - lp2);
        lp2 = ks;
        ks = ks * 0.48 + hp1 * 0.52;
        break;
      case "shoegaze":
        lp1 += 0.55 * (ks - lp1);
        ks = softDrive(lp1 * 3.0, 2.5) * (1 + Math.sin(i / sampleRate * 2.3) * 0.05);
        break;
      case "ambient":
        lp1 += 0.18 * (ks - lp1);
        lp2 += 0.25 * (lp1 - lp2);
        ks = lp2 * (1 + Math.sin(i / sampleRate * 0.8) * 0.02);
        break;
      case "bossa":
        lp1 += 0.28 * (ks - lp1);
        lp2 += 0.42 * (lp1 - lp2);
        ks = lp2 * (1 + Math.sin(i / sampleRate * 5.5) * 0.006);
        break;
      default:
        lp1 += Math.max(0.18, cutoff) * (ks - lp1);
        ks = lp1;
    }

    data[i] = ks;
  }

  if (p.body > 0) {
    const bodyPeriod = Math.max(8, Math.round(sampleRate / (freq * 1.98)));
    const amount = p.body * 0.15;
    for (let i = bodyPeriod; i < len; i++) {
      data[i] += data[i - bodyPeriod] * amount;
    }
  }

  if (p.drive > 1.1) {
    for (let i = 0; i < len; i++) {
      data[i] = softDrive(data[i], p.drive);
    }
  }

  const buffer = ctx.createBuffer(1, len, sampleRate);
  buffer.getChannelData(0).set(data);
  return buffer;
}

function softDrive(sample, drive) {
  return (2 / Math.PI) * Math.atan(sample * drive) / Math.max(1, drive * 0.38);
}

function guitarLaneForMidi(midi) {
  return clamp(5 - Math.floor((midi - 40) / 5), 0, 5);
}

function playDrum(id, velocity = 0.85) {
  const ctx = ensureAudio();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  const out = ctx.createGain();
  const toneFactor = lerp(0.62, 1.38, drumControls.tone);
  const decayFactor = lerp(0.62, 1.85, drumControls.decay);
  const driveFactor = lerp(0.9, 1.38, drumControls.drive);
  out.gain.value = state.faders.VOL * drumControls.level * velocity * driveFactor;
  out.connect(masterGain);
  out.connect(fxSend);
  if (fxSend) fxSend.gain.setTargetAtTime((state.faders.FX * 0.22) + (drumControls.space * 0.24), now, 0.015);

  if (id === "kick") {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(135 * toneFactor, now);
    osc.frequency.exponentialRampToValueAtTime(42 * toneFactor, now + 0.18 * decayFactor);
    out.gain.setValueAtTime(velocity, now);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 0.28 * decayFactor);
    osc.connect(out);
    osc.start(now);
    osc.stop(now + 0.3 * decayFactor);
    return;
  }

  if (id === "snare") {
    const body = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    body.type = "triangle";
    body.frequency.setValueAtTime(190 * toneFactor, now);
    body.frequency.exponentialRampToValueAtTime(118 * toneFactor, now + 0.12 * decayFactor);
    bodyGain.gain.setValueAtTime(velocity * 0.34, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16 * decayFactor);
    body.connect(bodyGain);
    bodyGain.connect(out);
    body.start(now);
    body.stop(now + 0.18);
  }

  if (id === "tom") {
    const body = ctx.createOscillator();
    body.type = "sine";
    body.frequency.setValueAtTime(210 * toneFactor, now);
    body.frequency.exponentialRampToValueAtTime(86 * toneFactor, now + 0.26 * decayFactor);
    out.gain.setValueAtTime(velocity * 0.72, now);
    out.gain.exponentialRampToValueAtTime(0.0001, now + 0.38 * decayFactor);
    body.connect(out);
    body.start(now);
    body.stop(now + 0.4 * decayFactor);
    return;
  }

  const noise = ctx.createBufferSource();
  noise.buffer = makeNoiseBuffer(ctx, (id === "crash" || id === "ride" ? 1.1 : 0.32) * decayFactor);
  const filter = ctx.createBiquadFilter();
  filter.type = id === "tom" ? "bandpass" : "highpass";
  filter.frequency.value = {
    snare: 1200,
    clap: 900,
    tom: 220,
    hat: 5200,
    hatOpen: 4300,
    crash: 3100,
    ride: 3800
  }[id] * toneFactor || 1600 * toneFactor;
  filter.Q.value = id === "tom" ? 5 : 0.8 + state.reso * 4;
  out.gain.setValueAtTime(velocity * (id === "hat" ? 0.34 : 0.62), now);
  out.gain.exponentialRampToValueAtTime(0.0001, now + (id === "crash" || id === "ride" ? 0.9 : 0.2) * decayFactor);
  noise.connect(filter);
  filter.connect(out);
  noise.start(now);
  noise.stop(now + 1.0 * decayFactor);
}

function playKey(midi, object, pointerId = 0) {
  unlockAudio();
  const adjusted = midi + state.octaveShift;
  flashKey(object, true);
  updateDisplayForKey(adjusted);

  if (state.arp && state.currentMode === "drum") {
    const sequence = ["kick", "hat", "snare", "hatOpen", "tom", "crash"];
    sequence.forEach((id, index) => {
      window.setTimeout(() => {
        playDrum(id, 0.68);
        updateDisplay("DRUM KIT", id.toUpperCase(), "ARP");
      }, index * 105);
    });
    window.setTimeout(() => flashKey(object, false), 180);
    return;
  }

  if (state.arp && state.currentMode !== "guitar") {
    const pattern = [0, 4, 7, 12];
    pattern.forEach((offset, index) => {
      window.setTimeout(() => {
        const arpVoice = triggerByMode(adjusted + offset, 0.68);
        if (arpVoice) window.setTimeout(() => releaseVoice(arpVoice), state.currentMode === "bass" ? 260 : 210);
      }, index * 105);
    });
    window.setTimeout(() => flashKey(object, false), 180);
    return;
  }

  const voice = triggerByMode(adjusted, 0.82);
  if (voice && !state.hold) {
    activePointers.set(pointerId, { voice, key: object });
  } else if (voice) {
    window.setTimeout(() => releaseVoice(voice), 1700);
    window.setTimeout(() => flashKey(object, false), 180);
  } else {
    window.setTimeout(() => flashKey(object, false), 160);
  }
}

function triggerByMode(midi, velocity) {
  if (state.currentMode === "drum") {
    playDrum(drumForMidi(midi), velocity);
    return null;
  }
  if (state.currentMode === "guitar") {
    return createPluckVoice(midi, velocity);
  }
  if (state.currentMode === "bass") {
    return createSynthVoice(midi, velocity, { bass: true, wave: WAVES[state.currentWave]?.osc || WAVES.SAW.osc });
  }
  return createSynthVoice(midi, velocity);
}

function drumForMidi(midi) {
  const pc = ((midi % 12) + 12) % 12;
  if (!WHITE_PCS.has(pc)) {
    if (midi < 55) return pc === 1 ? "kick" : "snare";
    if (midi < 64) return pc === 6 ? "tom" : "clap";
    return pc === 10 ? "crash" : "hatOpen";
  }

  const whiteSteps = [0, 2, 4, 5, 7, 9, 11];
  const octave = Math.floor((midi - 48) / 12);
  const step = whiteSteps.indexOf(pc);
  const whiteIndex = octave * 7 + step;
  if (whiteIndex <= 2) return "kick";
  if (whiteIndex <= 5) return "snare";
  if (whiteIndex <= 8) return whiteIndex === 8 ? "clap" : "tom";
  if (whiteIndex <= 11) return whiteIndex === 11 ? "hatOpen" : "hat";
  return whiteIndex >= 14 ? "ride" : "crash";
}

function pointerUp(pointerId) {
  const held = activePointers.get(pointerId);
  if (held) {
    flashKey(held.key, false);
    if (held.voice) releaseVoice(held.voice);
    activePointers.delete(pointerId);
  }
  dragState = null;
}

function cancelActiveControlPointers() {
  activePointers.forEach((held) => {
    flashKey(held.key, false);
    if (held.voice) releaseVoice(held.voice, { force: true });
  });
  activePointers.clear();
  dragState = null;
}

function muteOutputForMarkerLoss() {
  if (!audioCtx || !masterGain) return;
  const now = audioCtx.currentTime;
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setTargetAtTime(0.0001, now, 0.012);
}

function restoreOutputForMarkerFound() {
  if (!audioCtx || !masterGain) return;
  const now = audioCtx.currentTime;
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setTargetAtTime(state.faders.VOL, now, 0.018);
}

function flashKey(key, active) {
  if (!key?.userData?.baseColor) return;
  const data = key.userData;
  key.position.z = active ? data.baseZ - 0.025 : data.baseZ;
  key.material.color.setHex(active ? data.activeColor : data.baseColor);
  key.material.emissive.setHex(active ? data.activeColor : 0x000000);
  key.material.emissiveIntensity = active ? 0.45 : 0.05;
}

function flashDrumPad(pad, active) {
  if (!pad?.userData?.baseColor) return;
  const data = pad.userData;
  pad.position.z = active ? data.baseZ - 0.018 : data.baseZ;
  pad.material.color.setHex(active ? data.activeColor : data.baseColor);
  pad.material.emissive.setHex(active ? data.activeColor : 0x000000);
  pad.material.emissiveIntensity = active ? 0.62 : 0.05;
}

function createScene() {
  const canvas = $("#synth-canvas") || $("#guitar-canvas");
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0, 6.2);
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();

  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.55);
  key.position.set(1.8, 3.2, 4.0);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x67f4ff, 1.1);
  rim.position.set(-2.4, 1.2, 2.8);
  scene.add(rim);

  synthGroup = new THREE.Group();
  synthGroup.name = "AR_Mini_Synth_Workstation";
  synthGroup.matrixAutoUpdate = false;
  synthGroup.visible = false;
  scene.add(synthGroup);
  buildSynthModel();
  drumGroup = new THREE.Group();
  drumGroup.name = "QR_Drum_Machine";
  drumGroup.matrixAutoUpdate = false;
  drumGroup.visible = false;
  scene.add(drumGroup);
  buildDrumMachineModel();
  activeModelGroup = synthGroup;
  resizeCanvas();
  bindCanvasEvents(canvas);
  requestAnimationFrame(render);
}

function addInteractive(mesh, interaction) {
  mesh.userData.interaction = interaction;
  interactives.push(mesh);
  return mesh;
}

function buildSynthModel() {
  interactives = [];
  const bodyMat = makeMaterial({ color: 0x141a22, roughness: 0.55, metalness: 0.32 });
  const sideMat = makeMaterial({ color: 0x07090d, roughness: 0.72, metalness: 0.22 });
  const panelMat = makeMaterial({ color: 0x1c2632, roughness: 0.48, metalness: 0.36 });

  const base = new THREE.Mesh(new THREE.BoxGeometry(5.55, 2.32, 0.30), bodyMat);
  base.position.set(0, -0.12, -0.08);
  synthGroup.add(base);

  const backLip = new THREE.Mesh(new THREE.BoxGeometry(5.55, 0.16, 0.36), sideMat);
  backLip.position.set(0, 1.02, 0.06);
  synthGroup.add(backLip);

  const panel = new THREE.Group();
  panel.name = "synth_slanted_control_panel";
  panel.position.set(0, 0.43, 0.10);
  panel.rotation.x = -0.18;
  synthGroup.add(panel);

  const panelPlate = new THREE.Mesh(new THREE.BoxGeometry(5.30, 1.16, 0.18), panelMat);
  panelPlate.position.set(0, 0, 0);
  panel.add(panelPlate);

  addLabel(panel, "AR MINI SYNTH WORKSTATION", 0, 0.48, 0.112, 2.4, 0.14, { fontSize: 20, color: "#dbfff5" });
  buildPresetButtons(panel);
  buildWaveButtons(panel);
  buildFilterKnobs(panel);
  buildFaders(panel);
  buildPerformanceButtons(panel);
  buildScreen(panel);
  buildTouchStrips(panel);
  buildKeyboard();
  selectPreset("SYNTH");
  selectWave("SAW");
  updateDisplay("SYNTH", "SAW", "READY");
}

function buildDrumMachineModel() {
  drumControlMeshes = new Map();
  const baseMat = makeMaterial({ color: 0x101821, roughness: 0.54, metalness: 0.38 });
  const sideMat = makeMaterial({ color: 0x05080d, roughness: 0.62, metalness: 0.30 });
  const panelMat = makeMaterial({ color: 0x17202a, roughness: 0.46, metalness: 0.42 });

  const base = new THREE.Mesh(new THREE.BoxGeometry(5.65, 2.20, 0.32), baseMat);
  base.position.set(0, -0.08, -0.10);
  drumGroup.add(base);

  const frontLip = new THREE.Mesh(new THREE.BoxGeometry(5.70, 0.18, 0.28), sideMat);
  frontLip.position.set(0, -1.10, 0.04);
  drumGroup.add(frontLip);

  const panel = new THREE.Group();
  panel.name = "drum_machine_panel";
  panel.position.set(0, 0.08, 0.14);
  panel.rotation.x = -0.15;
  drumGroup.add(panel);

  const panelPlate = new THREE.Mesh(new THREE.BoxGeometry(5.34, 1.78, 0.18), panelMat);
  panelPlate.position.set(0, 0, 0);
  panel.add(panelPlate);

  addLabel(panel, "QR DRUM MACHINE", -1.75, 0.72, 0.16, 1.55, 0.15, { fontSize: 22, color: "#dbfff5" });
  const pads = [
    ["kick", "Kick", -1.92, 0.38, 0xff6b3a],
    ["snare", "Snare", -1.20, 0.38, 0x3aa6ff],
    ["clap", "Clap", -0.48, 0.38, 0xffdf6e],
    ["rim", "Rim", 0.24, 0.38, 0xb26bff],
    ["hat", "Hi-Hat", -1.92, -0.16, 0x63e6be],
    ["hatOpen", "Open Hat", -1.20, -0.16, 0x63e6be],
    ["tom", "Tom", -0.48, -0.16, 0xffa23a],
    ["crash", "Crash", 0.24, -0.16, 0xf45cff]
  ];
  pads.forEach(([id, label, x, y, color]) => createDrumPad(panel, id, label, x, y, color));

  createDrumButton(panel, "PLAY", 0.95, -0.62, 0x32c7ff, () => playDrumPattern());
  createDrumButton(panel, "STOP", 1.55, -0.62, 0xffdf6e, () => stopDrumPattern());
  createDrumButton(panel, "REC", 2.15, -0.62, 0xff5a66, () => updateDrumDisplay("QR DRUM", "REC", "READY"));

  const screen = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.44, 0.08), makeMaterial({ color: 0x051311, emissive: 0x0b4639, roughness: 0.22 }));
  screen.position.set(2.05, 0.48, 0.17);
  panel.add(screen);
  drumScreenMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
  const display = new THREE.Mesh(new THREE.PlaneGeometry(1.02, 0.32), drumScreenMaterial);
  display.position.set(2.05, 0.48, 0.23);
  panel.add(display);

  const knobs = [
    ["tone", "TONE", 1.28, 0.06, 0x3aa6ff],
    ["decay", "DECAY", 1.78, 0.06, 0xffdf6e],
    ["drive", "DRIVE", 2.28, 0.06, 0xffa23a],
    ["space", "SPACE", 1.54, -0.32, 0xb26bff],
    ["level", "LEVEL", 2.06, -0.32, 0x63e6be]
  ];
  knobs.forEach(([id, label, x, y, color]) => createDrumKnob(panel, id, label, x, y, color));
  updateDrumDisplay("QR DRUM", "128 BPM", "READY");
}

function createDrumPad(parent, id, label, x, y, color) {
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.40, 0.10), makeMaterial({ color: 0x202b36, emissive: 0x000000, roughness: 0.40, metalness: 0.18 }));
  pad.position.set(x, y, 0.16);
  pad.userData.baseColor = 0x202b36;
  pad.userData.activeColor = color;
  pad.userData.baseZ = pad.position.z;
  parent.add(pad);
  addInteractive(pad, { kind: "drumPad", id });
  addLabel(parent, label, x, y, 0.23, 0.52, 0.12, { fontSize: 22, color: "#f6fff8" });
  return pad;
}

function createDrumButton(parent, label, x, y, color, action) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.24, 0.09), makeMaterial({ color: 0x273241, emissive: color, roughness: 0.36, metalness: 0.25 }));
  mesh.position.set(x, y, 0.18);
  mesh.userData.baseColor = 0x273241;
  mesh.userData.activeColor = color;
  parent.add(mesh);
  addInteractive(mesh, { kind: "drumButton", label, action });
  addLabel(parent, label, x, y, 0.25, 0.38, 0.11, { fontSize: 22, color: "#ffffff" });
  return mesh;
}

function createDrumKnob(parent, id, label, x, y, color) {
  const value = drumControls[id] ?? 0.5;
  const group = new THREE.Group();
  group.position.set(x, y, 0.18);
  parent.add(group);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 32), makeMaterial({ color: 0x0a0d12, emissive: color, roughness: 0.34, metalness: 0.45 }));
  base.rotation.x = Math.PI / 2;
  group.add(base);
  const indicator = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.13, 0.024), makeMaterial({ color, emissive: color }));
  indicator.position.set(0, 0.05, 0.06);
  group.add(indicator);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.04), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }));
  hit.position.set(x, y, 0.26);
  parent.add(hit);
  addInteractive(hit, { kind: "drumKnob", id });
  addLabel(parent, label, x, y - 0.26, 0.22, 0.36, 0.10, { fontSize: 16, color: "#f6fff8" });
  const knob = { group, indicator, value, color };
  drumControlMeshes.set(id, knob);
  updateDrumKnobVisual(knob);
  return knob;
}

function updateDrumKnobVisual(knob) {
  const angle = lerp(-2.10, 2.10, knob.value);
  knob.indicator.rotation.z = -angle;
  knob.group.children[0].material.emissiveIntensity = 0.16 + knob.value * 0.72;
}

function updateDrumDisplay(line1, line2, line3) {
  if (!drumScreenMaterial) return;
  const texture = labelTexture([line1, line2, line3].filter(Boolean), {
    width: 512,
    height: 192,
    background: "#04110f",
    color: "#63e6be",
    fontSize: 34
  });
  if (drumScreenMaterial.map) drumScreenMaterial.map.dispose();
  drumScreenMaterial.map = texture;
  drumScreenMaterial.needsUpdate = true;
}

function playDrumPattern() {
  const pattern = [
    ["kick", 0],
    ["hat", 120],
    ["snare", 240],
    ["hat", 360],
    ["kick", 480],
    ["hatOpen", 600],
    ["snare", 720],
    ["crash", 840]
  ];
  pattern.forEach(([id, delay]) => {
    window.setTimeout(() => {
      if (window.activeInstrument?.instrumentType !== "drum-machine") return;
      playDrum(id, 0.76);
      updateDrumDisplay("QR DRUM", id.toUpperCase(), "PLAY");
    }, delay);
  });
}

function stopDrumPattern() {
  updateDrumDisplay("QR DRUM", "STOP", "READY");
}

function isDescendantOf(object, parent) {
  let current = object;
  while (current) {
    if (current === parent) return true;
    current = current.parent;
  }
  return false;
}

function createButton(parent, label, x, y, color, interaction, size = { w: 0.58, h: 0.22 }) {
  const mat = makeMaterial({ color: 0x26313e, emissive: 0x000000, roughness: 0.42, metalness: 0.25 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.w, size.h, 0.08), mat);
  mesh.position.set(x, y, 0.13);
  mesh.userData.baseColor = 0x26313e;
  mesh.userData.activeColor = color;
  mesh.userData.isActive = false;
  parent.add(mesh);
  addInteractive(mesh, interaction);
  addLabel(parent, label, x, y, 0.18, size.w * 0.9, size.h * 0.7, { fontSize: 26, color: "#f6fff8" });
  return mesh;
}

function buildPresetButtons(panel) {
  addLabel(panel, "PRESET", -2.08, 0.31, 0.18, 0.86, 0.13, { fontSize: 18, color: "#9cecff" });
  const entries = [
    ["SYNTH", -2.08, 0.10],
    ["GUITAR", -2.08, -0.16],
    ["DRUM", -2.08, -0.42],
    ["BASS", -2.08, -0.68]
  ];
  entries.forEach(([id, x, y]) => {
    const mesh = createButton(panel, id, x, y, PRESETS[id].color, { kind: "preset", id }, { w: 0.78, h: 0.22 });
    ui.presetButtons.set(id, mesh);
  });
}

function buildWaveButtons(panel) {
  addLabel(panel, "WAVE", -1.15, 0.31, 0.18, 0.78, 0.13, { fontSize: 18, color: "#9cecff" });
  const entries = [
    ["SAW", -1.15, 0.10],
    ["SQUARE", -1.15, -0.18],
    ["SINE", -1.15, -0.46]
  ];
  entries.forEach(([id, x, y]) => {
    const mesh = createButton(panel, id, x, y, WAVES[id].color, { kind: "wave", id }, { w: 0.78, h: 0.22 });
    ui.waveButtons.set(id, mesh);
  });
}

function buildFilterKnobs(panel) {
  addLabel(panel, "FILTER", -0.12, 0.31, 0.18, 0.76, 0.13, { fontSize: 18, color: "#9cecff" });
  const cutoff = createKnob(panel, "CUTOFF", -0.32, -0.06, 0.27, state.cutoff, 0x3aa6ff, "cutoff");
  const reso = createKnob(panel, "RESO", 0.28, -0.06, 0.20, state.reso, 0xffa23a, "reso");
  ui.knobs.set("cutoff", cutoff);
  ui.knobs.set("reso", reso);
}

function createKnob(parent, label, x, y, radius, value, color, id) {
  const group = new THREE.Group();
  group.position.set(x, y, 0.16);
  parent.add(group);
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.09, 36),
    makeMaterial({ color: 0x0a0d12, emissive: color, roughness: 0.34, metalness: 0.45 })
  );
  base.rotation.x = Math.PI / 2;
  group.add(base);
  const indicator = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.10, radius * 0.82, 0.026), makeMaterial({ color, emissive: color }));
  indicator.position.set(0, radius * 0.26, 0.07);
  group.add(indicator);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(radius * 2.25, radius * 2.25, 0.04), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }));
  hit.position.set(x, y, 0.24);
  parent.add(hit);
  addInteractive(hit, { kind: "knob", id });
  addLabel(parent, label, x, y - radius - 0.16, 0.20, radius * 2.2, 0.13, { fontSize: 18, color: "#f6fff8" });
  const knob = { group, indicator, value, color };
  updateKnobVisual(knob);
  return knob;
}

function updateKnobVisual(knob) {
  const angle = lerp(-2.25, 2.25, knob.value);
  knob.indicator.rotation.z = -angle;
  knob.group.children[0].material.emissiveIntensity = 0.12 + knob.value * 0.7;
}

function buildFaders(panel) {
  addLabel(panel, "ENVELOPE / FX", 1.33, 0.31, 0.18, 1.46, 0.13, { fontSize: 18, color: "#9cecff" });
  FADERS.forEach((item, index) => {
    const x = 0.62 + index * 0.29;
    const fader = createFader(panel, item.label, x, -0.18, item.color, item.id, item.value);
    ui.faders.set(item.id, fader);
  });
}

function createFader(parent, label, x, y, color, id, value) {
  const length = 0.58;
  const track = new THREE.Mesh(new THREE.BoxGeometry(0.05, length, 0.035), makeMaterial({ color: 0x070b10 }));
  track.position.set(x, y, 0.17);
  parent.add(track);
  const fill = new THREE.Mesh(new THREE.BoxGeometry(0.062, length, 0.02), makeMaterial({ color, emissive: color, transparent: true, opacity: 0.42 }));
  fill.position.set(x, y, 0.19);
  parent.add(fill);
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.09, 0.065), makeMaterial({ color, emissive: color, roughness: 0.3 }));
  parent.add(thumb);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.25, length + 0.14, 0.04), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }));
  hit.position.set(x, y, 0.25);
  parent.add(hit);
  addInteractive(hit, { kind: "fader", id });
  addLabel(parent, label, x, y - length / 2 - 0.15, 0.20, 0.22, 0.12, { fontSize: 20, color: "#f6fff8" });
  const fader = { x, y, length, thumb, fill, value, color };
  updateFaderVisual(fader);
  return fader;
}

function updateFaderVisual(fader) {
  const thumbY = fader.y - fader.length / 2 + fader.value * fader.length;
  fader.thumb.position.set(fader.x, thumbY, 0.24);
  fader.fill.scale.y = Math.max(0.04, fader.value);
  fader.fill.position.y = fader.y - fader.length / 2 + (fader.length * fader.value) / 2;
  fader.thumb.material.emissiveIntensity = 0.18 + fader.value * 0.75;
}

function buildPerformanceButtons(panel) {
  const positions = [-0.36, 0.04, 0.44];
  PERFORMANCE_BUTTONS.forEach((id, index) => {
    const mesh = createButton(panel, id, positions[index], -0.68, 0x63e6be, { kind: "performance", id }, { w: 0.34, h: 0.22 });
    ui.perfButtons.set(id, mesh);
  });
}

function buildScreen(panel) {
  const screen = new THREE.Mesh(new THREE.BoxGeometry(1.00, 0.46, 0.07), makeMaterial({ color: 0x061211, emissive: 0x113a31, roughness: 0.22 }));
  screen.position.set(2.18, 0.03, 0.16);
  panel.add(screen);
  screenMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
  const display = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.34), screenMaterial);
  display.position.set(2.18, 0.03, 0.22);
  panel.add(display);
}

function buildTouchStrips(panel) {
  const strips = [
    ["PITCH", -2.55, -0.24, 0xffdf6e],
    ["MOD", -2.55, -0.62, 0x63e6be]
  ];
  strips.forEach(([id, x, y, color]) => {
    const track = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.30, 0.05), makeMaterial({ color: 0x0a0e13, emissive: color }));
    track.position.set(x, y, 0.19);
    panel.add(track);
    const fill = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.06, 0.05), makeMaterial({ color, emissive: color }));
    fill.position.set(x, y, 0.24);
    panel.add(fill);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.42, 0.04), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }));
    hit.position.set(x, y, 0.28);
    panel.add(hit);
    addInteractive(hit, { kind: "strip", id });
    addLabel(panel, id, x + 0.30, y, 0.21, 0.36, 0.12, { fontSize: 18, color: "#f6fff8" });
    ui.strips.set(id, { fill, centerY: y, color, value: id === "PITCH" ? 0.5 : 0 });
  });
  updateStripVisual("PITCH");
  updateStripVisual("MOD");
}

function buildKeyboard() {
  const keyboardBase = new THREE.Mesh(new THREE.BoxGeometry(5.18, 0.96, 0.16), makeMaterial({ color: 0x07090d, roughness: 0.58, metalness: 0.28 }));
  keyboardBase.position.set(0.12, -0.72, 0.08);
  synthGroup.add(keyboardBase);

  addLabel(synthGroup, "25 KEY TOUCH SYNTH", 1.54, -1.20, 0.28, 1.35, 0.12, { fontSize: 18, color: "#9cecff" });
  createOctaveButton("OCT -", -2.28, -1.16, -12);
  createOctaveButton("OCT +", -1.72, -1.16, 12);

  const startMidi = 48;
  const endMidi = 72;
  const whiteCount = Array.from({ length: endMidi - startMidi + 1 }, (_, i) => startMidi + i)
    .filter((midi) => WHITE_PCS.has(midi % 12)).length;
  const whiteW = 4.84 / whiteCount;
  let whiteIndex = 0;
  for (let midi = startMidi; midi <= endMidi; midi++) {
    const pc = midi % 12;
    const isWhite = WHITE_PCS.has(pc);
    if (isWhite) {
      const x = (whiteIndex - (whiteCount - 1) / 2) * whiteW + 0.15;
      const key = new THREE.Mesh(new THREE.BoxGeometry(whiteW * 0.92, 0.78, 0.12), makeMaterial({ color: 0xf5f0df, roughness: 0.38, metalness: 0.05 }));
      key.position.set(x, -0.78, 0.22);
      key.userData.baseColor = 0xf5f0df;
      key.userData.activeColor = 0x3aa6ff;
      key.userData.baseZ = key.position.z;
      key.userData.midi = midi;
      synthGroup.add(key);
      addInteractive(key, { kind: "key", midi });
      ui.keys.set(midi, key);
      if (NOTE_NAMES[pc] === "C") {
        addLabel(synthGroup, `C${Math.floor(midi / 12) - 1}`, x, -1.11, 0.31, whiteW * 0.70, 0.10, { fontSize: 18, color: "#10131a" });
      }
      whiteIndex += 1;
    } else {
      const x = (whiteIndex - 1 - (whiteCount - 1) / 2) * whiteW + whiteW * 0.48 + 0.15;
      const key = new THREE.Mesh(new THREE.BoxGeometry(whiteW * 0.58, 0.47, 0.16), makeMaterial({ color: 0x05070a, roughness: 0.42, metalness: 0.1 }));
      key.position.set(x, -0.59, 0.34);
      key.userData.baseColor = 0x05070a;
      key.userData.activeColor = 0xb26bff;
      key.userData.baseZ = key.position.z;
      key.userData.midi = midi;
      synthGroup.add(key);
      addInteractive(key, { kind: "key", midi });
      ui.keys.set(midi, key);
    }
  }
}

function createOctaveButton(label, x, y, semitoneDelta) {
  const mesh = createButton(synthGroup, label, x, y, 0xffdf6e, { kind: "octave", semitoneDelta }, { w: 0.45, h: 0.18 });
  mesh.position.z = 0.32;
}

function setButtonActive(mesh, active, color) {
  if (!mesh) return;
  mesh.userData.isActive = active;
  mesh.material.color.setHex(active ? color : mesh.userData.baseColor);
  mesh.material.emissive.setHex(active ? color : 0x000000);
  mesh.material.emissiveIntensity = active ? 0.8 : 0.04;
}

function selectPreset(id) {
  if (!PRESETS[id]) return;
  unlockAudio();
  state.currentPreset = id;
  state.currentMode = PRESETS[id].mode;
  resetAudioForPreset(id);
  ui.presetButtons.forEach((mesh, key) => setButtonActive(mesh, key === id, PRESETS[key].color));
  updateDisplay(id === "DRUM" ? "DRUM KIT" : id, id === "SYNTH" || id === "BASS" ? state.currentWave : "PRESET", "READY");
}

function selectWave(id) {
  if (!WAVES[id]) return;
  state.currentWave = id;
  ui.waveButtons.forEach((mesh, key) => setButtonActive(mesh, key === id, WAVES[key].color));
  updateDisplay(state.currentPreset, id, "READY");
}

function togglePerformance(id) {
  if (id === "GLIDE") state.glide = !state.glide;
  if (id === "ARP") state.arp = !state.arp;
  if (id === "HOLD") state.hold = !state.hold;
  ui.perfButtons.forEach((mesh, key) => {
    const active = (key === "GLIDE" && state.glide) || (key === "ARP" && state.arp) || (key === "HOLD" && state.hold);
    setButtonActive(mesh, active, 0x63e6be);
  });
  updateDisplay(state.currentPreset, state.currentWave, `${id} ${ui.perfButtons.get(id)?.userData?.isActive ? "ON" : "OFF"}`);
}

function updateDisplay(line1, line2, line3) {
  if (!screenMaterial) return;
  const texture = labelTexture([line1, line2, line3].filter(Boolean), {
    width: 512,
    height: 192,
    background: "#04110f",
    color: "#63e6be",
    fontSize: 34
  });
  if (screenMaterial.map) screenMaterial.map.dispose();
  screenMaterial.map = texture;
  screenMaterial.needsUpdate = true;
}

function updateDisplayForKey(midi) {
  const name = `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  if (state.currentMode === "drum") {
    updateDisplay("DRUM KIT", drumForMidi(midi).toUpperCase(), "HIT");
    return;
  }
  updateDisplay(state.currentPreset, state.currentMode === "guitar" ? "GUITAR" : state.currentWave, name);
}

function handleControl(interaction, hit, event) {
  if (!interaction) return;
  unlockAudio();
  if (interaction.kind === "drumPad") {
    flashDrumPad(hit.object, true);
    playDrum(interaction.id, 0.88);
    updateDrumDisplay("QR DRUM", interaction.id.toUpperCase(), "HIT");
    window.setTimeout(() => flashDrumPad(hit.object, false), 150);
    return;
  }
  if (interaction.kind === "drumButton") {
    flashDrumPad(hit.object, true);
    interaction.action?.();
    window.setTimeout(() => flashDrumPad(hit.object, false), 150);
    return;
  }
  if (interaction.kind === "preset") selectPreset(interaction.id);
  if (interaction.kind === "wave") selectWave(interaction.id);
  if (interaction.kind === "performance") togglePerformance(interaction.id);
  if (interaction.kind === "octave") {
    state.octaveShift = clamp(state.octaveShift + interaction.semitoneDelta, -24, 24);
    updateDisplay(state.currentPreset, state.currentWave, `OCT ${state.octaveShift / 12}`);
  }
  if (interaction.kind === "key") playKey(interaction.midi, hit.object, event.pointerId);
  if (interaction.kind === "fader" || interaction.kind === "knob" || interaction.kind === "strip") {
    dragState = {
      kind: interaction.kind,
      id: interaction.id,
      lastX: event.clientX,
      lastY: event.clientY
    };
    updateDragControl(event);
  }
  if (interaction.kind === "drumKnob") {
    dragState = {
      kind: interaction.kind,
      id: interaction.id,
      lastX: event.clientX,
      lastY: event.clientY
    };
    updateDragControl(event);
  }
}

function updateDragControl(event) {
  if (!dragState) return;
  const dx = event.clientX - dragState.lastX;
  const dy = event.clientY - dragState.lastY;
  dragState.lastX = event.clientX;
  dragState.lastY = event.clientY;
  const delta = (-dy + dx * 0.45) / 180;

  if (dragState.kind === "fader") {
    const fader = ui.faders.get(dragState.id);
    if (!fader) return;
    fader.value = clamp(fader.value + delta, 0, 1);
    state.faders[dragState.id] = fader.value;
    updateFaderVisual(fader);
    if (dragState.id === "VOL" && masterGain) masterGain.gain.setTargetAtTime(fader.value, audioCtx.currentTime, 0.02);
    if (dragState.id === "FX" && fxSend) fxSend.gain.setTargetAtTime(fader.value * 0.34, audioCtx.currentTime, 0.02);
    if (dragState.id === "FX" && guitarReverbGain) guitarReverbGain.gain.setTargetAtTime(getOriginalGuitarParams().reverb * 0.36, audioCtx.currentTime, 0.02);
    updateDisplay(state.currentPreset, state.currentWave, `${dragState.id} ${Math.round(fader.value * 100)}`);
  }

  if (dragState.kind === "knob") {
    const knob = ui.knobs.get(dragState.id);
    if (!knob) return;
    knob.value = clamp(knob.value + delta, 0, 1);
    if (dragState.id === "cutoff") state.cutoff = knob.value;
    if (dragState.id === "reso") state.reso = knob.value;
    updateKnobVisual(knob);
    updateDisplay(state.currentPreset, state.currentWave, `${dragState.id.toUpperCase()} ${Math.round(knob.value * 100)}`);
  }

  if (dragState.kind === "strip") {
    const strip = ui.strips.get(dragState.id);
    if (!strip) return;
    strip.value = clamp(strip.value + (-dy / 160), 0, 1);
    if (dragState.id === "PITCH") state.pitchBend = (strip.value - 0.5) * 2;
    if (dragState.id === "MOD") state.mod = strip.value;
    updateStripVisual(dragState.id);
    updateDisplay(state.currentPreset, state.currentWave, `${dragState.id} ${Math.round(strip.value * 100)}`);
  }

  if (dragState.kind === "drumKnob") {
    const knob = drumControlMeshes.get(dragState.id);
    if (!knob) return;
    knob.value = clamp(knob.value + delta, 0, 1);
    drumControls[dragState.id] = knob.value;
    updateDrumKnobVisual(knob);
    updateDrumDisplay("QR DRUM", dragState.id.toUpperCase(), `${Math.round(knob.value * 100)}`);
  }
}

function updateStripVisual(id) {
  const strip = ui.strips.get(id);
  if (!strip) return;
  strip.fill.position.y = strip.centerY - 0.12 + strip.value * 0.24;
  strip.fill.material.emissiveIntensity = 0.18 + strip.value * 0.9;
}

function rememberTouchPoint(event) {
  activeTouchPoints.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY
  });
}

function getTwoTouchPoints() {
  return Array.from(activeTouchPoints.values()).slice(0, 2);
}

function beginTransformGesture() {
  const [a, b] = getTwoTouchPoints();
  if (!a || !b) return;
  cancelActiveControlPointers();
  transformGesture = {
    startDistance: Math.max(1, pointerDistance(a, b)),
    startScale: userTransform.scale
  };
  updateDisplay(state.currentPreset, state.currentWave, `SCALE ${Math.round(userTransform.scale * 100)}`);
}

function updateTransformGesture() {
  if (activeTouchPoints.size < 2) return;
  if (!transformGesture) beginTransformGesture();
  const [a, b] = getTwoTouchPoints();
  if (!a || !b || !transformGesture) return;
  const distance = Math.max(1, pointerDistance(a, b));
  const ratio = distance / transformGesture.startDistance;
  userTransform.scale = clamp(transformGesture.startScale * ratio, USER_SCALE_LIMITS.min, USER_SCALE_LIMITS.max);
  updateDisplay(state.currentPreset, state.currentWave, `SCALE ${Math.round(userTransform.scale * 100)}`);
}

function bindCanvasEvents(canvas) {
  if (!canvas || canvasBound) return;
  canvasBound = true;
  const getHit = (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(interactives, false);
    return hits.find((hit) => hit.object.visible !== false && isDescendantOf(hit.object, activeModelGroup));
  };

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    try { canvas.setPointerCapture(event.pointerId); } catch (err) {}
    rememberTouchPoint(event);
    if (activeTouchPoints.size >= 2) {
      beginTransformGesture();
      return;
    }
    if (!isMarkerVisible()) {
      unlockAudio();
      setPrompt("请先对准乐器识别卡");
      return;
    }
    const hit = getHit(event);
    if (hit) handleControl(hit.object.userData.interaction, hit, event);
  }, { passive: false });

  canvas.addEventListener("pointermove", (event) => {
    if (activeTouchPoints.has(event.pointerId)) {
      rememberTouchPoint(event);
    }
    if (activeTouchPoints.size >= 2) {
      event.preventDefault();
      updateTransformGesture();
      return;
    }
    if (!dragState) return;
    event.preventDefault();
    updateDragControl(event);
  }, { passive: false });

  const finishPointer = (event) => {
    const wasTransforming = Boolean(transformGesture);
    activeTouchPoints.delete(event.pointerId);
    if (activeTouchPoints.size < 2) transformGesture = null;
    if (!wasTransforming) pointerUp(event.pointerId);
  };
  canvas.addEventListener("pointerup", finishPointer);
  canvas.addEventListener("pointercancel", finishPointer);
  canvas.addEventListener("touchstart", () => unlockAudio(), { passive: true });
}

function resizeCanvas() {
  const canvas = $("#synth-canvas") || $("#guitar-canvas");
  const stage = $("#ar-stage");
  if (!canvas || !renderer || !camera || !stage) return;
  const rect = stage.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

async function startCameraMode() {
  const video = $("#camera-feed");
  const button = $("#camera-toggle");
  if (!video || cameraStream || cameraStarting) return;
  unlockAudio();
  setPrompt("正在打开相机");
  if (needsHttps()) {
    setPrompt("相机需要 HTTPS");
    return;
  }
  if (!hasCameraSupport()) {
    setPrompt("浏览器不支持相机");
    return;
  }
  cameraStarting = true;
  if (button) button.textContent = "正在打开相机";
  try {
    setPrompt("正在加载乐器卡 pattern");
    await ensurePatternTargetsLoaded();
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.srcObject = cameraStream;
    await video.play();
    $("#ar-stage")?.classList.add("camera-active");
    setStageWaiting(false);
    setPrompt(PROMPT_FIND_CARD);
    startMarkerTracking();
    if (button) button.textContent = "退出相机";
  } catch (err) {
    cameraStream = null;
    video.srcObject = null;
    setStageWaiting(true);
    setPrompt("相机未开启：请允许微信访问摄像头");
    if (button) button.textContent = "打开相机";
  } finally {
    cameraStarting = false;
  }
}

function stopCameraMode() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  const video = $("#camera-feed");
  if (video) video.srcObject = null;
  $("#ar-stage")?.classList.remove("camera-active");
  cancelActiveControlPointers();
  activeTouchPoints.clear();
  transformGesture = null;
  stopMarkerTracking();
  state.marker.locked = false;
  anchor.confidence = 0;
  deactivateInstrumentMarker();
  if (synthGroup) synthGroup.visible = false;
  if (drumGroup) drumGroup.visible = false;
  setSynthActive(false);
  setStageWaiting(true);
  setPrompt("请允许相机");
  const button = $("#camera-toggle");
  if (button) button.textContent = "打开相机";
}

function toggleCameraMode() {
  if (cameraStream || cameraStarting) stopCameraMode();
  else startCameraMode();
}

function getScanner() {
  if (!scanCanvas) {
    scanCanvas = document.createElement("canvas");
    scanCtx = scanCanvas.getContext("2d", { willReadFrequently: true });
  }
  return scanCtx ? { canvas: scanCanvas, ctx: scanCtx } : null;
}

function startMarkerTracking() {
  if (markerFrame) return;
  lastScanAt = 0;
  markerFrame = requestAnimationFrame(scanMarkerFrame);
}

function stopMarkerTracking() {
  if (markerFrame) cancelAnimationFrame(markerFrame);
  markerFrame = 0;
  anchor.confidence = 0;
  foundFrameCount = 0;
  lastCandidateAt = 0;
  lastCardPoseScan = null;
}

function scanMarkerFrame(time = 0) {
  if (!cameraStream) {
    hideMarker("请允许相机");
    markerFrame = 0;
    return;
  }
  if (time - lastScanAt >= MARKER_SCAN_INTERVAL) {
    lastScanAt = time;
    scanTextCardMarker();
  }
  markerFrame = requestAnimationFrame(scanMarkerFrame);
}

function scanTextCardMarker() {
  const video = $("#camera-feed");
  const scanner = getScanner();
  if (!video || !scanner) {
    updateArDebug({
      markerFound: false,
      poseFound: false,
      poseUpdated: false,
      pattWinner: "none",
      classifiedIdentity: "none",
      finalIdentity: "none"
    });
    hideMarker(PROMPT_FIND_CARD);
    return false;
  }
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    updateArDebug({
      markerFound: false,
      poseFound: false,
      poseUpdated: false,
      pattWinner: "none",
      classifiedIdentity: "none",
      finalIdentity: "none"
    });
    hideMarker(PROMPT_FIND_CARD);
    return false;
  }

  const maxSide = 720;
  const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.floor(video.videoWidth * scale));
  const height = Math.max(1, Math.floor(video.videoHeight * scale));
  if (scanner.canvas.width !== width) scanner.canvas.width = width;
  if (scanner.canvas.height !== height) scanner.canvas.height = height;
  scanner.ctx.drawImage(video, 0, 0, width, height);
  const imageData = scanner.ctx.getImageData(0, 0, width, height);
  const frame = { imageData, width, height };
  const pose = detectAnyCardPoseFromFrame(frame);
  const markerFound = Boolean(pose);
  const classification = markerFound ? classifyCard(frame, pose) : { identity: null, blueRatio: 0 };
  const cardId = classification.identity === "drum" ? "drum" : classification.identity === "synth" ? "hechengqi" : null;
  const cardTarget = cardId ? getCardTarget(cardId) : null;
  const finalIdentity = classification.identity || "none";
  updateArDebug({
    markerFound,
    poseFound: markerFound,
    pattWinner: pose?.pattWinner || pose?.cardId || "none",
    blueRatio: classification.blueRatio.toFixed(4),
    classifiedIdentity: classification.identity || "none",
    finalIdentity: finalIdentity || "none",
    poseUpdated: false
  });
  if (!markerFound) {
    return handleMarkerMiss(PROMPT_FIND_CARD);
  }
  if (!cardTarget) return handleMarkerMiss(PROMPT_FIND_CARD);
  const tracked = Boolean(pose && updateMarkerFromPose(pose, scale, {
    payload: pose.decodedPayload || cardTarget.encodedPayload || "instrument=synth",
    cardId,
    instrumentType: cardTarget.resolvedInstrument || cardTarget.markerResource?.instrumentType || cardTarget.instrumentId || "synthesizer",
    recognizedText: cardTarget.recognizedText || cardTarget.title || "",
    markerResource: cardTarget.markerResource || synthMarkerBinding,
    source: `${pose.source || "text-card"}+classify-card`,
    immediate: true
  }));
  updateArDebug({ poseUpdated: tracked });
  if (!tracked) return handleMarkerMiss(PROMPT_FIND_CARD);
  return tracked;
}

function handleMarkerMiss(promptText) {
  const now = performance.now();
  if (state.marker.locked && now - state.marker.lastSeenAt <= MARKER_LOST_TIMEOUT_MS) {
    if (promptText) setPrompt(promptText);
    return false;
  }
  hideMarker(promptText);
  return false;
}

function detectAnyCardPoseFromFrame(frame) {
  const hits = [];
  for (const target of getAllCardTargets()) {
    const pose = detectCardPoseFromFrame(target, frame);
    if (!pose) continue;
    hits.push({
      score: pose.patternConfidence || 0,
      pose: {
        ...pose,
        cardId: target.id,
        resolvedInstrument: target.resolvedInstrument || target.instrumentId,
        recognizedText: target.recognizedText || target.title,
        decodedPayload: target.encodedPayload || pose.decodedPayload
      }
    });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => b.score - a.score);
  const [best, runnerUp] = hits;
  best.pose.pattWinner = best.pose.cardId;
  best.pose.patternScores = hits.map((hit) => ({
    id: hit.pose.cardId,
    score: hit.score
  }));
  if (runnerUp && best.score - runnerUp.score < PATTERN_SWITCH_MARGIN) {
    console.warn("[AR pattern] ambiguous match kept as anchor pose", {
      best: best.pose.cardId,
      bestScore: best.score,
      runnerUp: runnerUp.pose.cardId,
      runnerUpScore: runnerUp.score
    });
  }
  return best.pose;
}

function classifyCard(frame, pose = null) {
  const blueRatio = pose?.center && pose?.xUnit && pose?.yUnit
    ? samplePoseBlueRatio(frame, pose, { x: 0.24, y: 0.24, w: 0.52, h: 0.52, cols: 56, rows: 56 })
    : sampleFrameCenterBlueRatio(frame);
  return {
    blueRatio,
    identity: blueRatio > BLUE_CARD_THRESHOLD ? "drum" : "synth"
  };
}

function samplePoseBlueRatio(frame, pose, region) {
  if (!frame?.imageData?.data || !pose?.center) return 0;
  const cols = region.cols || 48;
  const rows = region.rows || 48;
  const data = frame.imageData.data;
  let blue = 0;
  let total = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const nx = region.x + ((col + 0.5) / cols) * region.w;
      const ny = region.y + ((row + 0.5) / rows) * region.h;
      const p = {
        x: pose.center.x + pose.xUnit.x * (nx - 0.5) * pose.halfW * 2 + pose.yUnit.x * (ny - 0.5) * pose.halfH * 2,
        y: pose.center.y + pose.xUnit.y * (nx - 0.5) * pose.halfW * 2 + pose.yUnit.y * (ny - 0.5) * pose.halfH * 2
      };
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) continue;
      const i = (y * frame.width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (b > 100 && b > r * 1.3 && b > g * 1.1) blue += 1;
      total += 1;
    }
  }
  return total ? blue / total : 0;
}

function sampleFrameCenterBlueRatio(frame) {
  if (!frame?.imageData?.data) return 0;
  const data = frame.imageData.data;
  const minX = Math.floor(frame.width * 0.30);
  const maxX = Math.ceil(frame.width * 0.70);
  const minY = Math.floor(frame.height * 0.30);
  const maxY = Math.ceil(frame.height * 0.70);
  let blue = 0;
  let total = 0;
  for (let y = minY; y < maxY; y += 2) {
    for (let x = minX; x < maxX; x += 2) {
      const i = (y * frame.width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (b > 100 && b > r * 1.3 && b > g * 1.1) blue += 1;
      total += 1;
    }
  }
  return total ? blue / total : 0;
}

function mapVideoPointToStage(point, scanScale) {
  const video = $("#camera-feed");
  const stage = $("#ar-stage");
  const rect = stage?.getBoundingClientRect();
  if (!video || !rect?.width || !rect?.height || !video.videoWidth || !video.videoHeight) {
    return { x: 0.5, y: 0.5, px: rect?.width ? rect.width * 0.5 : 0, py: rect?.height ? rect.height * 0.5 : 0 };
  }
  const nativeX = point.x / scanScale;
  const nativeY = point.y / scanScale;
  const coverScale = Math.max(rect.width / video.videoWidth, rect.height / video.videoHeight);
  const shownW = video.videoWidth * coverScale;
  const shownH = video.videoHeight * coverScale;
  const px = nativeX * coverScale + (rect.width - shownW) * 0.5;
  const py = nativeY * coverScale + (rect.height - shownH) * 0.5;
  return { x: px / rect.width, y: py / rect.height, px, py };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function updateMarkerFromImageTracker(scanScale, frame) {
  if (!lastCardPoseScan || !state.marker.cardId) return false;
  const cardTarget = getCardTarget(state.marker.cardId);
  const pose = trackCardPoseFromFrame(lastCardPoseScan, cardTarget, frame);
  if (!isReliableImageTrackedPose(pose, cardTarget, frame)) return false;
  return pose;
}

function isReliableImageTrackedPose(pose, cardTarget, frame) {
  if (!pose) return false;
  const strongCorners = (pose.markerRatios || [])
    .filter((ratio) => ratio >= MIN_IMAGE_TRACK_CORNER_RATIO)
    .length;
  const textConfidence = sampleTrackedCardTextConfidence(pose, cardTarget, frame);
  const dataConfidence = sampleTrackedCardDataConfidence(pose, cardTarget, frame);
  pose.textConfidence = textConfidence;
  pose.dataConfidence = dataConfidence;
  pose.decodedPayload = cardTarget?.encodedPayload || "";
  const policy = cardTarget?.recognition || {};
  const markerConfidence = pose.wholeCardConfidence ?? 0;
  const textMin = policy.minTextConfidence ?? cardTarget?.textSignatureMinConfidence ?? 0.42;
  const dataMin = policy.minDataConfidence ?? cardTarget?.dataSignature?.minConfidence ?? 0.48;
  const combinedMin = policy.minCombinedConfidence ?? 0.54;
  const hasEnoughCorners = pose.visibleMarkers >= REQUIRED_IMAGE_TRACK_CORNERS
    && strongCorners >= Math.max(3, REQUIRED_IMAGE_TRACK_CORNERS - 1)
    && markerConfidence >= Math.min(MIN_IMAGE_TRACK_CONFIDENCE, policy.minCornerConfidence ?? 0.44);
  const combined = markerConfidence * 0.48 + textConfidence * 0.34 + dataConfidence * 0.18;
  return hasEnoughCorners
    && (textConfidence >= textMin || dataConfidence >= dataMin || textConfidence >= textMin * 0.72)
    && combined >= combinedMin * 0.88;
}

function sampleTrackedCardTextConfidence(pose, cardTarget, frame) {
  if (!pose || !cardTarget?.textSignatureRegions?.length || !frame?.imageData?.data) return 0;
  let passed = 0;
  let confidence = 0;
  for (const region of cardTarget.textSignatureRegions) {
    const ratio = samplePoseRegionDarkRatio(pose, frame, region);
    const minRatio = region.minDarkRatio ?? 0.035;
    if (ratio >= minRatio) passed += 1;
    confidence += Math.min(1, ratio / Math.max(minRatio, 0.001));
  }
  const averageConfidence = confidence / cardTarget.textSignatureRegions.length;
  return passed >= Math.max(1, cardTarget.textSignatureRegions.length - 1)
    ? averageConfidence
    : averageConfidence * 0.58;
}

function sampleTrackedCardDataConfidence(pose, cardTarget, frame) {
  const signature = cardTarget?.dataSignature;
  if (!signature?.bits || !frame?.imageData?.data) return 1;
  let score = 0;
  const bits = String(signature.bits);
  for (let index = 0; index < bits.length; index += 1) {
    const bit = bits[index];
    const region = {
      x: signature.x + (signature.w / bits.length) * index + signature.w / bits.length * 0.18,
      y: signature.y,
      w: signature.w / bits.length * 0.64,
      h: signature.h,
      cols: 3,
      rows: 4
    };
    const ratio = samplePoseRegionDarkRatio(pose, frame, region);
    if (bit === "1") {
      const minRatio = signature.oneMinDarkRatio ?? 0.18;
      score += ratio >= minRatio ? 1 : Math.max(0, ratio / minRatio);
    } else {
      const limit = signature.zeroMaxDarkRatio ?? 0.13;
      score += ratio <= limit ? 1 : Math.max(0, 1 - (ratio - limit) / Math.max(limit, 0.01));
    }
  }
  return score / bits.length;
}

function samplePoseRegionDarkRatio(pose, frame, region) {
  const cols = region.cols || 24;
  const rows = region.rows || 8;
  const data = frame.imageData.data;
  let dark = 0;
  let total = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const nx = region.x + ((col + 0.5) / cols) * region.w;
      const ny = region.y + ((row + 0.5) / rows) * region.h;
      const p = new THREE.Vector2(
        pose.center.x + pose.xUnit.x * (nx - 0.5) * pose.halfW * 2 + pose.yUnit.x * (ny - 0.5) * pose.halfH * 2,
        pose.center.y + pose.xUnit.y * (nx - 0.5) * pose.halfW * 2 + pose.yUnit.y * (ny - 0.5) * pose.halfH * 2
      );
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) continue;
      const i = (y * frame.width + x) * 4;
      const luminance = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (luminance < 108) dark += 1;
      total += 1;
    }
  }
  return total ? dark / total : 0;
}

function updateMarkerFromPose(pose, scanScale, details) {
  const location = pose?.location;
  if (!location) return false;
  const now = performance.now();
  const requiredFrames = details.immediate ? 1 : REQUIRED_FOUND_FRAMES;
  if (!state.marker.locked) {
    if (now - lastCandidateAt > MARKER_CANDIDATE_RESET_MS) foundFrameCount = 0;
    lastCandidateAt = now;
    foundFrameCount += 1;
    lastCardPoseScan = pose;
    if (foundFrameCount < requiredFrames) {
      setPrompt(`正在稳定识别卡片 ${foundFrameCount}/${requiredFrames}`);
      return false;
    }
  } else {
    foundFrameCount = Math.max(foundFrameCount, requiredFrames);
    lastCandidateAt = now;
  }

  const tl = mapVideoPointToStage(location.topLeftCorner, scanScale);
  const tr = mapVideoPointToStage(location.topRightCorner, scanScale);
  const br = mapVideoPointToStage(location.bottomRightCorner, scanScale);
  const bl = mapVideoPointToStage(location.bottomLeftCorner, scanScale);
  const rect = $("#ar-stage")?.getBoundingClientRect();
  const minSide = Math.max(1, Math.min(rect?.width || 1, rect?.height || 1));
  const topW = dist(tl, tr);
  const bottomW = dist(bl, br);
  const leftH = dist(tl, bl);
  const rightH = dist(tr, br);
  const center = pose.anchorCenter
    ? mapVideoPointToStage(pose.anchorCenter, scanScale)
    : {
        x: (tl.x + tr.x + br.x + bl.x) * 0.25,
        y: (tl.y + tr.y + br.y + bl.y) * 0.25
      };

  const projectedSize = ((topW + bottomW + leftH + rightH) * 0.25) / minSide;
  const angle = Math.atan2(tr.py - tl.py, tr.px - tl.px);
  const tiltX = clamp((rightH - leftH) / Math.max(leftH + rightH, 1), -0.38, 0.38);
  const tiltY = clamp((bottomW - topW) / Math.max(topW + bottomW, 1), -0.38, 0.38);
  const poseMatrix = composeMarkerPoseMatrixFromCorners({
    cardId: details.cardId,
    tl,
    tr,
    br,
    bl,
    centerX: center.x,
    centerY: center.y,
    size: Math.max(0.001, projectedSize),
    angle,
    tiltX,
    tiltY
  });
  state.marker = {
    locked: true,
    payload: details.payload,
    cardId: details.cardId,
    instrumentType: details.instrumentType || "synthesizer",
    recognizedText: details.recognizedText || "",
    lastSeenAt: now,
    poseMatrix,
    centerX: center.x,
    centerY: center.y,
    size: Math.max(0.001, projectedSize),
    angle,
    tiltX,
    tiltY
  };
  lastCardPoseScan = pose;
  activateInstrumentMarker(details);
  if (activeModelGroup) activeModelGroup.visible = true;
  setSynthActive(true);
  restoreOutputForMarkerFound();
  setPrompt(details.instrumentType === "drum-machine" ? "QR Drum Machine" : "AR Mini Synth Workstation");
  return true;
}

function updateArDebug(partial = {}) {
  Object.assign(arDebugState, partial);
  arDebugState.shownModel = drumGroup?.visible && activeModelGroup === drumGroup
    ? "drum"
    : synthGroup?.visible && activeModelGroup === synthGroup
      ? "synth"
      : "none";
  arDebugState["drumModel.visible"] = Boolean(drumGroup?.visible);
  arDebugState["synthModel.visible"] = Boolean(synthGroup?.visible);
  const panel = $("#ar-debug-panel");
  if (!panel) return;
  panel.innerHTML = Object.entries(arDebugState)
    .map(([key, value]) => `<div><b>${key}</b>: ${String(value)}</div>`)
    .join("");
}

function isMarkerVisible() {
  return state.marker.locked;
}

function updateMarkerLost() {
  enforceMarkerTimeout();
}

function enforceMarkerTimeout(now = performance.now()) {
  if (!cameraStream && state.marker.locked) {
    hideMarker(PROMPT_FIND_CARD);
    return false;
  }
  if (state.marker.locked && now - state.marker.lastSeenAt > MARKER_LOST_TIMEOUT_MS) {
    hideMarker(PROMPT_FIND_CARD);
    return false;
  }
  return state.marker.locked;
}

function hideMarker(promptText) {
  state.marker.locked = false;
  state.marker.lastSeenAt = 0;
  anchor = createEmptyAnchor();
  foundFrameCount = 0;
  lastCandidateAt = 0;
  lastCardPoseScan = null;
  cancelActiveControlPointers();
  muteOutputForMarkerLoss();
  deactivateInstrumentMarker();
  if (synthGroup) synthGroup.visible = false;
  if (drumGroup) drumGroup.visible = false;
  setSynthActive(false);
  updateArDebug({
    markerFound: false,
    poseFound: false,
    pattWinner: "none",
    classifiedIdentity: "none",
    finalIdentity: "none",
    shownModel: "none",
    poseUpdated: false,
    "drumModel.visible": false,
    "synthModel.visible": false
  });
  if (promptText) setPrompt(promptText);
}

function markerTargetForView() {
  const card = getCardTarget(state.marker.cardId);
  const cardAnchor = card.anchor || {};
  const z = markerZFromCardSize(cardAnchor.zOffset ?? 0.10);
  const position = screenPointToWorldAtZ(state.marker.centerX, state.marker.centerY, z);
  return {
    x: position.x,
    y: position.y,
    z,
    scale: FIXED_SYNTH_SCALE * userTransform.scale * (cardAnchor.modelScale || 1),
    angle: state.marker.angle,
    tiltX: state.marker.tiltX,
    tiltY: state.marker.tiltY
  };
}

function composeMarkerPoseMatrix(marker) {
  const card = getCardTarget(marker.cardId);
  const cardAnchor = card.anchor || {};
  const z = markerZFromCardSize(cardAnchor.zOffset ?? 0.10, marker.size);
  const position2d = screenPointToWorldAtZ(marker.centerX, marker.centerY, z);
  const position = new THREE.Vector3(position2d.x, position2d.y, z);
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    -0.35 + marker.tiltY * 0.42,
    marker.tiltX * 0.42,
    marker.angle,
    "XYZ"
  ));
  const scale = FIXED_SYNTH_SCALE * userTransform.scale * (cardAnchor.modelScale || 1);
  return new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(scale, scale, scale));
}

function composeMarkerPoseMatrixFromCorners(marker) {
  const card = getCardTarget(marker.cardId);
  const cardAnchor = card.anchor || {};
  const z = markerZFromCardSize(cardAnchor.zOffset ?? 0.10, marker.size);
  const worldTl = stagePointToWorldAtZ(marker.tl, z);
  const worldTr = stagePointToWorldAtZ(marker.tr, z);
  const worldBr = stagePointToWorldAtZ(marker.br, z);
  const worldBl = stagePointToWorldAtZ(marker.bl, z);
  const leftMid = new THREE.Vector3().addVectors(worldTl, worldBl).multiplyScalar(0.5);
  const rightMid = new THREE.Vector3().addVectors(worldTr, worldBr).multiplyScalar(0.5);
  const topMid = new THREE.Vector3().addVectors(worldTl, worldTr).multiplyScalar(0.5);
  const bottomMid = new THREE.Vector3().addVectors(worldBl, worldBr).multiplyScalar(0.5);
  const position = new THREE.Vector3()
    .addVectors(leftMid, rightMid)
    .multiplyScalar(0.5);
  const xAxis = new THREE.Vector3().subVectors(rightMid, leftMid);
  const yAxis = new THREE.Vector3().subVectors(bottomMid, topMid);
  const angle = Math.atan2(xAxis.y, xAxis.x);
  const tiltX = clamp((worldBr.distanceTo(worldTr) - worldBl.distanceTo(worldTl)) / Math.max(worldBr.distanceTo(worldTr) + worldBl.distanceTo(worldTl), 0.001), -0.5, 0.5);
  const tiltY = clamp((worldBr.distanceTo(worldBl) - worldTr.distanceTo(worldTl)) / Math.max(worldBr.distanceTo(worldBl) + worldTr.distanceTo(worldTl), 0.001), -0.5, 0.5);
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    -0.35 + tiltY * 0.85,
    tiltX * 0.85,
    angle,
    "XYZ"
  ));
  const scale = FIXED_SYNTH_SCALE * userTransform.scale * (cardAnchor.modelScale || 1);
  return new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(scale, scale, scale));
}

function stagePointToWorldAtZ(point, z) {
  const mapped = screenPointToWorldAtZ(point.x, point.y, z);
  return new THREE.Vector3(mapped.x, mapped.y, z);
}

function markerZFromCardSize(defaultZ = 0.10, markerSize = state.marker.size) {
  if (!camera) return defaultZ;
  const size = Math.max(0.001, markerSize || MARKER_REFERENCE_SIZE);
  const distance = clamp(
    MARKER_REFERENCE_DISTANCE * (MARKER_REFERENCE_SIZE / size),
    MARKER_MIN_DISTANCE,
    MARKER_MAX_DISTANCE
  );
  return camera.position.z - distance;
}

function screenPointToWorldAtZ(x, y, z) {
  if (!camera) return { x: 0, y: 0 };
  const view = getViewWorldSize(z);
  return {
    x: (x - 0.5) * view.width,
    y: (0.5 - y) * view.height
  };
}

function getViewWorldSize(z = 0) {
  if (!camera) return { width: 5.8, height: 3.0 };
  const distance = Math.max(0.1, camera.position.z - z);
  const height = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * distance;
  return {
    width: height * camera.aspect,
    height
  };
}

function updateAnchor(portrait) {
  const visible = isMarkerVisible();
  if (!visible) {
    anchor.confidence = 0;
    return;
  }
  anchor.poseMatrix = state.marker.poseMatrix || composeMarkerPoseMatrix(state.marker);
  anchor.confidence = 1;
}

function render(time = 0) {
  enforceMarkerTimeout(time || performance.now());
  const stage = $("#ar-stage");
  const rect = stage?.getBoundingClientRect();
  const portrait = (rect?.height || window.innerHeight) >= (rect?.width || window.innerWidth);
  updateAnchor(portrait);

  if (activeModelGroup) {
    const visible = isMarkerVisible();
    if (synthGroup) synthGroup.visible = visible && activeModelGroup === synthGroup;
    if (drumGroup) drumGroup.visible = visible && activeModelGroup === drumGroup;
    updateArDebug({
      shownModel: visible && activeModelGroup === drumGroup
        ? "drum"
        : visible && activeModelGroup === synthGroup
          ? "synth"
          : "none",
      "drumModel.visible": Boolean(drumGroup?.visible),
      "synthModel.visible": Boolean(synthGroup?.visible)
    });
    if (!visible) {
      renderer.render(scene, camera);
      requestAnimationFrame(render);
      return;
    }
    if (anchor.poseMatrix) {
      activeModelGroup.matrix.copy(anchor.poseMatrix);
      activeModelGroup.matrixAutoUpdate = false;
      activeModelGroup.matrixWorldNeedsUpdate = true;
      activeModelGroup.updateMatrixWorld(true);
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

function bindEvents() {
  $("#start-ar")?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    unlockAudio();
    hideWelcome();
    startCameraMode();
  }, { passive: false });
  $("#start-ar")?.addEventListener("touchstart", () => unlockAudio(), { passive: true });
  $("#start-ar")?.addEventListener("click", (event) => {
    event.preventDefault();
    unlockAudio();
  });
  $("#camera-toggle")?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    toggleCameraMode();
  });
  $("#reset-view")?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    resetUserTransform();
    hideMarker("视角已重置，请重新对准乐器识别卡");
    updateDisplay(state.currentPreset, state.currentWave, "VIEW RESET");
  });
  document.addEventListener("WeixinJSBridgeReady", () => {
    if (audioCtx) audioCtx.resume?.().catch(() => {});
  }, false);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && audioCtx) audioCtx.resume?.().catch(() => {});
  });
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("orientationchange", () => window.setTimeout(resizeCanvas, 120));
}

function init() {
  unregisterServiceWorkers();
  bindEvents();
  createScene();
  selectPreset("SYNTH");
  selectWave("SAW");
  setStageWaiting(true);
  setPrompt("请允许相机");
  showWelcome();
  updateArDebug();
}

function unregisterServiceWorkers() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.getRegistrations()
    .then((registrations) => registrations.forEach((registration) => registration.unregister()))
    .catch(() => {});
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
