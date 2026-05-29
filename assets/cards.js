export const DEFAULT_CARD_ID = "hechengqi";

export const markerResourceMap = {
  hechengqi: {
    markerUrl: "./assets/markers/synth.patt",
    markerImageUrl: "./assets/marker-card.png",
    instrumentType: "synthesizer",
    cardId: "hechengqi"
  },
  drum: {
    markerUrl: "./assets/markers/drum.patt",
    markerImageUrl: "./assets/markers/drum.png",
    instrumentType: "drum-machine",
    cardId: "drum"
  }
};

export function getMarkerResource(cardId = DEFAULT_CARD_ID) {
  return markerResourceMap[cardId] || markerResourceMap[DEFAULT_CARD_ID];
}
