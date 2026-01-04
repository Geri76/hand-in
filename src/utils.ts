import { file_helper } from "./file_helper.js";
import { HANDIN_VERSION } from "./version_helper.js";

function rgbToAnsi256({ r, g, b }: { r: number; g: number; b: number }): string {
  return `\x1b[38;2;${r};${g};${b}m`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const bigint = parseInt(hex.replace("#", ""), 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return { r, g, b };
}

async function checkForUpdate(): Promise<string | undefined> {
  const currentVersion = HANDIN_VERSION;

  const response = await fetch("https://raw.githubusercontent.com/Geri76/hand-in/main/package.json");
  const data = await response.json();

  const latestVersion = data.version;

  if (currentVersion !== latestVersion) {
    return latestVersion;
  }

  return undefined;
}

export { rgbToAnsi256, hexToRgb, checkForUpdate };
