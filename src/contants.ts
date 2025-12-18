import { hexToRgb, rgbToAnsi256 } from "./utils.js";

const COLORS = {
  RED: rgbToAnsi256(hexToRgb("#e34a6f")),
  GREEN: rgbToAnsi256(hexToRgb("#01857f")),
  YELLOW: rgbToAnsi256(hexToRgb("#f1c40f")),
  BLUE: rgbToAnsi256(hexToRgb("#5adbff")),
  RESET: "\x1b[0m",
};

export { COLORS };
