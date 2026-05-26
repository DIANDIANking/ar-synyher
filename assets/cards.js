export const DEFAULT_CARD_ID = "hechengqi";

export const markerResourceMap = {
  hechengqi: {
    markerUrl: "./assets/markers/pattern-hechengqi.patt",
    markerImageUrl: "./assets/marker-card.png",
    instrumentType: "synthesizer",
    modelUrl: "runtime:synth-workstation",
    initAudioEngineName: "initSynthesizer",
    playHandlerName: "playSynthesizerNote",
    cardId: "hechengqi"
  }
};

export const instrumentTextMap = {
  "合成器": "synthesizer",
  synthesizer: "synthesizer",
  synth: "synthesizer"
};

export const CARD_TARGETS = {
  hechengqi: {
    id: "hechengqi",
    instrumentId: "synthesizer",
    title: "合成器",
    markerText: ["合成器", "hechengqi"],
    recognizedText: "合成器",
    resolvedInstrument: instrumentTextMap["合成器"],
    encodedPayload: "instrument=synthesizer;card=hechengqi;markerText=合成器",
    image: markerResourceMap.hechengqi.markerImageUrl,
    markerResource: markerResourceMap.hechengqi,
    cardAspect: 1,
    qrCenterYOffset: 0,
    cornerMarkerRatio: {
      x: 0.84,
      y: 0.855
    },
    textSignatureMinConfidence: 0.18,
    textSignatureRegions: [
      { x: 0.30, y: 0.30, w: 0.40, h: 0.40, minDarkRatio: 0.10 },
      { x: 0.34, y: 0.34, w: 0.32, h: 0.32, minDarkRatio: 0.16 }
    ],
    textPanel: {
      x: 0.30,
      y: 0.30,
      w: 0.40,
      h: 0.40,
      minWhiteRatio: 0.38,
      minDarkSurroundRatio: 0.34,
      minTextDarkRatio: 0.10
    },
    hiroMarker: {
      enabled: true,
      anchorRegion: "textPanel",
      requireTextPanelOnly: true,
      decodedInstrument: "synthesizer"
    },
    recognition: {
      minTextConfidence: 0.16,
      minDataConfidence: 0.20,
      minCombinedConfidence: 0.30,
      minCornerConfidence: 0.18,
      strictDataSignature: false
    },
    anchor: {
      anchorMode: "card-center",
      liftPortrait: 1.10,
      liftLandscape: 0.74,
      modelScale: 1.0,
      yOffset: 0.08,
      zOffset: 0.10
    }
  },
  "card-synth-v1": {
    id: "card-synth-v1",
    instrumentId: "synthesizer",
    title: "合成器",
    markerText: ["合成器"],
    recognizedText: "合成器",
    resolvedInstrument: instrumentTextMap["合成器"],
    encodedPayload: "instrument=synthesizer;card=card-synth-v1;markerText=合成器",
    image: "./assets/marker-card.png",
    cardAspect: 1,
    qrCenterYOffset: 0,
    cornerMarkerRatio: {
      x: 0.84,
      y: 0.855
    },
    textSignatureMinConfidence: 0.36,
    textSignatureRegions: [
      { x: 0.278, y: 0.350, w: 0.444, h: 0.242, minDarkRatio: 0.080 },
      { x: 0.318, y: 0.410, w: 0.364, h: 0.145, minDarkRatio: 0.130 }
    ],
    textPanel: {
      x: 0.252,
      y: 0.312,
      w: 0.496,
      h: 0.312,
      minWhiteRatio: 0.52,
      minDarkSurroundRatio: 0.34,
      minTextDarkRatio: 0.070
    },
    hiroMarker: {
      enabled: true,
      anchorRegion: "textPanel",
      decodedInstrument: "synth"
    },
    recognition: {
      minTextConfidence: 0.30,
      minDataConfidence: 0.20,
      minCombinedConfidence: 0.42,
      minCornerConfidence: 0.24,
      strictDataSignature: false
    },
    anchor: {
      anchorMode: "card-center",
      liftPortrait: 1.10,
      liftLandscape: 0.74,
      modelScale: 1.0,
      yOffset: 0.08,
      zOffset: 0.10
    }
  }
};

export function getCardTarget(id = DEFAULT_CARD_ID) {
  return CARD_TARGETS[id] || CARD_TARGETS[DEFAULT_CARD_ID];
}
