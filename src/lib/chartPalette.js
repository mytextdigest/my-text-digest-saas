// Validated categorical palette + chart chrome tokens (dataviz skill reference
// palette). Colors are picked by fixed slot order, never cycled/generated.

export const CATEGORICAL = {
  light: ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7", "#e34948", "#e87ba4", "#eb6834"],
  dark: ["#3987e5", "#199e70", "#c98500", "#008300", "#9085e9", "#e66767", "#d55181", "#d95926"],
};

export const CHROME = {
  light: {
    surface: "#fcfcfb",
    primaryInk: "#0b0b0b",
    secondaryInk: "#52514e",
    mutedInk: "#898781",
    gridline: "#e1e0d9",
    axis: "#c3c2b7",
  },
  dark: {
    surface: "#1a1a19",
    primaryInk: "#ffffff",
    secondaryInk: "#c3c2b7",
    mutedInk: "#898781",
    gridline: "#2c2c2a",
    axis: "#383835",
  },
};

export function seriesColor(index, mode = "light") {
  const palette = CATEGORICAL[mode] || CATEGORICAL.light;
  return palette[index % palette.length];
}

export function chartChrome(mode = "light") {
  return CHROME[mode] || CHROME.light;
}
