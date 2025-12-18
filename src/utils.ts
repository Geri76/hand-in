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

export { rgbToAnsi256, hexToRgb };
