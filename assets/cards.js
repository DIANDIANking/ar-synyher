export const DEFAULT_CARD_ID = "card-synth-v1";

export const CARD_TARGETS = {
  "card-synth-v1": {
    id: "card-synth-v1",
    instrumentId: "synth",
    title: "增强现实乐器 / 合成器 / synthesizer",
    markerText: ["增强现实乐器", "合成器", "synthesizer"],
    encodedPayload: "instrument=synth;card=card-synth-v1;markerText=增强现实乐器|合成器|synthesizer",
    image: "./assets/marker-card.png",
    cardAspect: 1250 / 1390,
    qrCenterYOffset: 0,
    cornerMarkerRatio: {
      x: 0.84,
      y: 0.855
    },
    textSignatureMinConfidence: 0.78,
    textSignatureRegions: [
      { x: 0.18, y: 0.155, w: 0.64, h: 0.075, minDarkRatio: 0.035 },
      { x: 0.26, y: 0.255, w: 0.48, h: 0.100, minDarkRatio: 0.045 },
      { x: 0.31, y: 0.335, w: 0.38, h: 0.070, minDarkRatio: 0.035 }
    ],
    dataSignature: {
      bits: "101101001110010110100111",
      x: 0.2344,
      y: 0.4914,
      w: 0.5312,
      h: 0.023,
      minConfidence: 0.82,
      oneMinDarkRatio: 0.18,
      zeroMaxDarkRatio: 0.13
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
