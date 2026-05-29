/**
 * Audio Engine for AR Synth Workstation
 * All Web Audio API synthesis code, loaded as a regular script before A-Frame components.
 * Exposes window.__audio with all public methods.
 */
(function () {
  "use strict";

  // ============================================================
  // Constants
  // ============================================================
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

  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const WHITE_PCS = new Set([0, 2, 4, 5, 7, 9, 11]);
  const MIN_SYNTH_NOTE_HOLD_MS = 230;
  const MIN_BASS_NOTE_HOLD_MS = 280;

  const ORIGINAL_GUITAR_PARAMS = {
    style: "folk", attack: 0.002, decay: 0.05, sustain: 0.62, release: 2.2,
    cutoff: 0.48, brightness: 0.9982, drive: 1.0, body: 0.52,
    reverb: 0.24, chorus: 0.06, vibrato: 0.02, stringType: "steel"
  };
  const GUITAR_CONTROL_DEFAULTS = { cutoff: 0.62, fx: 0.22 };
  const GUITE222_GUITAR_PARAMS = {
    attack: 0.002, decay: 0.06, sustain: 0.55, release: 2.5, cutoff: 0.45, brightness: 0.9985
  };
  const GUITE222_BASE_FREQ = 82.41;
  const GUITE222_BASE_MIDI = 48;

  const DRUM_CONTROLS_DEFAULTS = {
    tone: 0.62, decay: 0.52, drive: 0.25, space: 0.35, level: 0.82
  };

  // ============================================================
  // State
  // ============================================================
  const state = {
    currentMode: "synth", currentPreset: "SYNTH", currentWave: "SAW",
    octaveShift: 0, cutoff: 0.62, reso: 0.28, pitchBend: 0, mod: 0,
    glide: false, arp: false, hold: false,
    faders: Object.fromEntries(FADERS.map(function (item) { return [item.id, item.value]; })),
    lastFreq: null
  };

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
  let drumControls = Object.assign({}, DRUM_CONTROLS_DEFAULTS);

  // ============================================================
  // Utilities
  // ============================================================
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // ============================================================
  // Audio setup
  // ============================================================
  function ensureAudio() {
    if (audioCtx) return audioCtx;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx({ latencyHint: "interactive" });
    if (navigator.audioSession) {
      try { navigator.audioSession.type = "playback"; } catch (e) {}
    }
    masterGain = audioCtx.createGain();
    masterGain.gain.value = state.faders.VOL;
    var compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -18; compressor.knee.value = 22;
    compressor.ratio.value = 5; compressor.attack.value = 0.006; compressor.release.value = 0.18;
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
    guitarReverbGain.gain.value = ORIGINAL_GUITAR_PARAMS.reverb * 0.36;
    guitarReverbSend.connect(guitarReverbConvolver);
    guitarReverbConvolver.connect(guitarReverbGain);
    guitarReverbGain.connect(masterGain);
    return audioCtx;
  }

  function createImpulseResponse(ctx, duration, decay) {
    var len = Math.max(1, Math.floor(ctx.sampleRate * duration));
    var buffer = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var channel = 0; channel < 2; channel++) {
      var data = buffer.getChannelData(channel);
      for (var i = 0; i < len; i++) {
        var t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * 0.35;
      }
    }
    return buffer;
  }

  function unlockAudio() {
    var ctx = ensureAudio();
    if (!ctx) return;
    try {
      if (ctx.state === "suspended") ctx.resume().catch(function () {});
      if (audioUnlocked) return;
      var buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      var source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
      audioUnlocked = true;
    } catch (e) {}
  }

  // ============================================================
  // Synthesis helpers
  // ============================================================
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

  function makeNoiseBuffer(ctx, duration) {
    duration = duration || 0.7;
    var length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    var buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < length; i++) { data[i] = Math.random() * 2 - 1; }
    return buffer;
  }

  function applyVoiceEnvelope(gain, velocity, sustainMultiplier) {
    sustainMultiplier = sustainMultiplier || 1;
    var ctx = audioCtx;
    var adsr = getAdsr();
    var now = ctx.currentTime;
    var peak = clamp(velocity * state.faders.VOL, 0.001, 0.95);
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + adsr.attack);
    gain.gain.setTargetAtTime(peak * adsr.sustain * sustainMultiplier, now + adsr.attack, adsr.decay / 3);
  }

  var activeVoices = [];

  function releaseVoice(voice, options) {
    options = options || {};
    if (!voice || !audioCtx || voice.released) return;
    var now = audioCtx.currentTime;
    var wait = options.force ? 0 : Math.max(0, (voice.minHoldUntil || now) - now);
    if (wait <= 0.005) { noteOff(voice, options); return; }
    if (voice.releaseTimer) return;
    voice.releaseTimer = window.setTimeout(function () {
      voice.releaseTimer = 0;
      noteOff(voice, options);
    }, wait * 1000);
  }

  function noteOff(voice, options) {
    options = options || {};
    if (!voice || !audioCtx || voice.released) return;
    voice.released = true;
    if (voice.releaseTimer) { window.clearTimeout(voice.releaseTimer); voice.releaseTimer = 0; }
    var adsr = getAdsr();
    var now = audioCtx.currentTime;
    var rel = options.force ? 0.035 : (state.hold ? Math.max(adsr.release, 1.0) : adsr.release);
    try {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0.0001, now, rel / 4);
      voice.source.stop(now + rel + 0.08);
    } catch (e) {}
    window.setTimeout(function () {
      try { voice.source.disconnect(); voice.filter.disconnect(); voice.gain.disconnect(); } catch (e) {}
    }, (rel + 0.2) * 1000);
  }

  // ============================================================
  // Synth voice
  // ============================================================
  function createSynthVoice(midi, velocity, options) {
    options = options || {};
    velocity = velocity || 0.78;
    var ctx = ensureAudio();
    if (!ctx) return null;
    if (ctx.state === "suspended") ctx.resume().catch(function () {});
    var now = ctx.currentTime;
    var freq = midiToFrequency(midi + (options.bass ? -12 : 0));
    var wave = (options.wave || WAVES[state.currentWave].osc);
    var filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 180 + Math.pow(state.cutoff, 1.4) * (options.bass ? 3600 : 11800);
    filter.Q.value = 0.7 + state.reso * 12;
    var gain = ctx.createGain();
    gain.gain.value = 0.0001;
    var source, oscillator = null;
    source = ctx.createOscillator();
    oscillator = source;
    source.type = wave;
    if (state.glide && state.lastFreq) {
      source.frequency.setValueAtTime(state.lastFreq, now);
      source.frequency.exponentialRampToValueAtTime(Math.max(20, freq), now + 0.11);
    } else { source.frequency.value = freq; }
    source.detune.value = state.pitchBend * 200;
    if (state.mod > 0.02) {
      var lfo = ctx.createOscillator();
      var lfoGain = ctx.createGain();
      lfo.frequency.value = 4.5 + state.mod * 5;
      lfoGain.gain.value = state.mod * (options.bass ? 10 : 24);
      lfo.connect(lfoGain); lfoGain.connect(source.detune);
      lfo.start(now);
      window.setTimeout(function () {
        try { lfo.stop(); lfo.disconnect(); lfoGain.disconnect(); } catch (e) {}
      }, 2600);
    }
    applyVoiceEnvelope(gain, velocity, options.bass ? 0.8 : 1);
    source.connect(filter); filter.connect(gain);
    gain.connect(masterGain); gain.connect(fxSend);
    source.start(now);
    var voice = {
      source: source, oscillator: oscillator, gain: gain, filter: filter,
      startedAt: now,
      minHoldUntil: now + ((options.bass ? MIN_BASS_NOTE_HOLD_MS : MIN_SYNTH_NOTE_HOLD_MS) / 1000),
      released: false, releaseTimer: 0
    };
    state.lastFreq = freq;
    return voice;
  }

  // ============================================================
  // Drum synthesis
  // ============================================================
  function playDrum(id, velocity) {
    velocity = velocity || 0.85;
    var ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(function () {});
    var now = ctx.currentTime;
    var out = ctx.createGain();
    var toneFactor = lerp(0.62, 1.38, drumControls.tone);
    var decayFactor = lerp(0.62, 1.85, drumControls.decay);
    var driveFactor = lerp(0.9, 1.38, drumControls.drive);
    out.gain.value = state.faders.VOL * drumControls.level * velocity * driveFactor;
    out.connect(masterGain);
    out.connect(fxSend);
    if (fxSend) fxSend.gain.setTargetAtTime((state.faders.FX * 0.22) + (drumControls.space * 0.24), now, 0.015);

    if (id === "kick") {
      var osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(135 * toneFactor, now);
      osc.frequency.exponentialRampToValueAtTime(42 * toneFactor, now + 0.18 * decayFactor);
      out.gain.setValueAtTime(velocity, now);
      out.gain.exponentialRampToValueAtTime(0.0001, now + 0.28 * decayFactor);
      osc.connect(out); osc.start(now); osc.stop(now + 0.3 * decayFactor);
      return;
    }

    if (id === "tom") {
      var body2 = ctx.createOscillator();
      body2.type = "sine";
      body2.frequency.setValueAtTime(210 * toneFactor, now);
      body2.frequency.exponentialRampToValueAtTime(86 * toneFactor, now + 0.26 * decayFactor);
      out.gain.setValueAtTime(velocity * 0.72, now);
      out.gain.exponentialRampToValueAtTime(0.0001, now + 0.38 * decayFactor);
      body2.connect(out); body2.start(now); body2.stop(now + 0.4 * decayFactor);
      return;
    }

    if (id === "snare") {
      var bodySn = ctx.createOscillator();
      var bodyGain = ctx.createGain();
      bodySn.type = "triangle";
      bodySn.frequency.setValueAtTime(190 * toneFactor, now);
      bodySn.frequency.exponentialRampToValueAtTime(118 * toneFactor, now + 0.12 * decayFactor);
      bodyGain.gain.setValueAtTime(velocity * 0.34, now);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16 * decayFactor);
      bodySn.connect(bodyGain); bodyGain.connect(out);
      bodySn.start(now); bodySn.stop(now + 0.18);
    }

    var noise = ctx.createBufferSource();
    noise.buffer = makeNoiseBuffer(ctx, (id === "crash" || id === "ride" ? 1.1 : 0.32) * decayFactor);
    var filt = ctx.createBiquadFilter();
    filt.type = id === "tom" ? "bandpass" : "highpass";
    var freqMap = { snare: 1200, clap: 900, tom: 220, hat: 5200, hatOpen: 4300, crash: 3100, ride: 3800 };
    filt.frequency.value = (freqMap[id] || 1600) * toneFactor;
    filt.Q.value = id === "tom" ? 5 : 0.8 + state.reso * 4;
    out.gain.setValueAtTime(velocity * (id === "hat" ? 0.34 : 0.62), now);
    out.gain.exponentialRampToValueAtTime(0.0001, now + (id === "crash" || id === "ride" ? 0.9 : 0.2) * decayFactor);
    noise.connect(filt); filt.connect(out);
    noise.start(now); noise.stop(now + 1.0 * decayFactor);
  }

  // ============================================================
  // Guitar (Karplus-Strong) — simplified inline fallback
  // ============================================================
  var guite222WorkletUrl;
  function setWorkletUrl(url) { guite222WorkletUrl = url; }

  function queueGuite222GuitarWorkletLoad() {
    if (!audioCtx || guite222GuitarNode || guite222GuitarReady || guite222GuitarFailed) return guite222GuitarReady;
    if (!audioCtx.audioWorklet || typeof AudioWorkletNode === "undefined") {
      guite222GuitarFailed = true; return null;
    }
    if (!guite222WorkletUrl) { guite222GuitarFailed = true; return null; }
    guite222GuitarReady = audioCtx.audioWorklet
      .addModule(guite222WorkletUrl)
      .then(function () {
        guite222GuitarNode = new AudioWorkletNode(audioCtx, "guitar-processor");
        guite222GuitarNode.connect(audioCtx.destination);
        return guite222GuitarNode;
      })
      .catch(function (err) {
        guite222GuitarFailed = true;
        console.warn("guitar worklet failed", err);
        return null;
      });
    return guite222GuitarReady;
  }

  function playGuitarNote(midi, velocity) {
    velocity = velocity || 0.85;
    var ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(function () {});
    var freq = GUITE222_BASE_FREQ * Math.pow(2, (midi - GUITE222_BASE_MIDI) / 12);
    var message = {
      type: "pluck", freq: freq, velocity: 0.85,
      params: Object.assign({}, GUITE222_GUITAR_PARAMS)
    };
    if (guite222GuitarNode) { guite222GuitarNode.port.postMessage(message); return; }
    var ready = queueGuite222GuitarWorkletLoad();
    if (ready) {
      ready.then(function (node) {
        if (node) node.port.postMessage(message);
        else playGuitarFallbackNote(freq, velocity);
      });
      return;
    }
    playGuitarFallbackNote(freq, velocity);
  }

  function playGuitarFallbackNote(freq, velocity) {
    var ctx = ensureAudio();
    if (!ctx || !freq) return;
    var sampleRate = ctx.sampleRate;
    var size = clamp(Math.round(sampleRate / freq), 8, 2400);
    var duration = 3.5;
    var length = Math.max(size + 2, Math.floor(sampleRate * duration));
    var buffer = ctx.createBuffer(1, length, sampleRate);
    var out2 = buffer.getChannelData(0);
    var delay = new Float32Array(size);
    for (var i = 0; i < size; i++) {
      var n = (Math.random() * 2 - 1) * velocity;
      if (i > 1) n = delay[i - 2] * 0.15 + delay[i - 1] * 0.55 + n * 0.30;
      delay[i] = n;
    }
    var pos = 0, amp = 0, lp1 = 0;
    var phase = "attack";
    var dt = 1 / sampleRate;
    var p = GUITE222_GUITAR_PARAMS;
    for (var j = 0; j < length; j++) {
      var env = 0;
      if (phase === "attack") { amp += dt / p.attack; if (amp >= 1) { amp = 1; phase = "decay"; } env = amp; }
      else if (phase === "decay") { amp -= dt / p.decay * (1 - p.sustain); if (amp <= p.sustain) { amp = p.sustain; phase = "sustain"; } env = amp; }
      else { env = p.sustain; }
      var next = (pos + 1) % size;
      var ks = (delay[pos] + delay[next]) * 0.5 * p.brightness;
      lp1 += p.cutoff * (ks - lp1);
      delay[pos] = lp1;
      pos = next;
      out2[j] = Math.tanh(lp1 * env * 0.45);
    }
    var source = ctx.createBufferSource();
    source.buffer = buffer;
    var gain = ctx.createGain();
    gain.gain.value = 0.9;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(ctx.currentTime);
    source.stop(ctx.currentTime + buffer.duration);
  }

  // ============================================================
  // Note name to MIDI
  // ============================================================
  function noteNameToMidi(note) {
    if (typeof note === "number" && isFinite(note)) return note;
    note = note || "C4";
    var match = String(note).trim().match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
    if (!match) return 60;
    var base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase()];
    var accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
    return (Number(match[3]) + 1) * 12 + base + accidental;
  }

  // ============================================================
  // MIDI to drum mapping
  // ============================================================
  function drumForMidi(midi) {
    var pc = ((midi % 12) + 12) % 12;
    if (!WHITE_PCS.has(pc)) {
      if (midi < 55) return pc === 1 ? "kick" : "snare";
      if (midi < 64) return pc === 6 ? "tom" : "clap";
      return pc === 10 ? "crash" : "hatOpen";
    }
    var whiteSteps = [0, 2, 4, 5, 7, 9, 11];
    var octave = Math.floor((midi - 48) / 12);
    var step = whiteSteps.indexOf(pc);
    var whiteIndex = octave * 7 + step;
    if (whiteIndex <= 2) return "kick";
    if (whiteIndex <= 5) return "snare";
    if (whiteIndex <= 8) return whiteIndex === 8 ? "clap" : "tom";
    if (whiteIndex <= 11) return whiteIndex === 11 ? "hatOpen" : "hat";
    return whiteIndex >= 14 ? "ride" : "crash";
  }

  // ============================================================
  // Trigger by mode
  // ============================================================
  function triggerByMode(midi, velocity) {
    velocity = velocity || 0.82;
    if (state.currentMode === "drum") { playDrum(drumForMidi(midi), velocity); return null; }
    if (state.currentMode === "guitar") { playGuitarNote(midi, velocity); return null; }
    if (state.currentMode === "bass") { return createSynthVoice(midi, velocity, { bass: true, wave: WAVES[state.currentWave] ? WAVES[state.currentWave].osc : WAVES.SAW.osc }); }
    return createSynthVoice(midi, velocity);
  }

  // ============================================================
  // Audio mute/restore for marker events
  // ============================================================
  function muteOutput() {
    if (!audioCtx || !masterGain) return;
    var now = audioCtx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setTargetAtTime(0.0001, now, 0.012);
  }

  function restoreOutput() {
    if (!audioCtx || !masterGain) return;
    var now = audioCtx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setTargetAtTime(state.faders.VOL, now, 0.018);
  }

  // ============================================================
  // Public API
  // ============================================================
  window.__audio = {
    PRESETS: PRESETS,
    WAVES: WAVES,
    FADERS: FADERS,
    NOTE_NAMES: NOTE_NAMES,
    WHITE_PCS: WHITE_PCS,
    DRUM_CONTROLS_DEFAULTS: DRUM_CONTROLS_DEFAULTS,

    state: state,
    drumControls: drumControls,

    ensureAudio: ensureAudio,
    unlockAudio: unlockAudio,
    createSynthVoice: createSynthVoice,
    playDrum: playDrum,
    playGuitarNote: playGuitarNote,
    triggerByMode: triggerByMode,
    releaseVoice: releaseVoice,
    noteOff: noteOff,
    drumForMidi: drumForMidi,
    noteNameToMidi: noteNameToMidi,
    muteOutput: muteOutput,
    restoreOutput: restoreOutput,
    setWorkletUrl: setWorkletUrl,
    getAdsr: getAdsr,
    clamp: clamp,
    lerp: lerp,
    midiToFrequency: midiToFrequency,
    makeNoiseBuffer: makeNoiseBuffer,
    applyVoiceEnvelope: applyVoiceEnvelope
  };

  console.log("[Audio] Engine loaded");
})();
