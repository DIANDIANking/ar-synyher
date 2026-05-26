export const DEFAULT_CARD_ID = "card-synth-v1";

export const CARD_TARGETS = {
  "card-synth-v1": {
    id: "card-synth-v1",
    instrumentId: "synth",
    title: "合成器",
    markerText: ["合成器"],
    encodedPayload: "instrument=synth;card=card-synth-v1;markerText=合成器",
    image: "./public/cards/synth-card.png",
    cardAspect: 1,
    qrCenterYOffset: 0,
    cornerMarkerRatio: {
      x: 0.84,
      y: 0.855
    },
    textSignatureMinConfidence: 0.36,
    textSignatureRegions: [
      { x: 0.275, y: 0.360, w: 0.450, h: 0.235, minDarkRatio: 0.085 },
      { x: 0.325, y: 0.430, w: 0.350, h: 0.140, minDarkRatio: 0.145 }
    ],
    textPanel: {
      x: 0.253,
      y: 0.310,
      w: 0.494,
      h: 0.309,
      minWhiteRatio: 0.46,
      minDarkSurroundRatio: 0.28,
      minTextDarkRatio: 0.075
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
