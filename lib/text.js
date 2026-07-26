const { createCanvas } = require('canvas');

const DEFAULT_FONT = '14px sans-serif';
const LINE_HEIGHT = 20;

/**
 * Renders plain text to a PNG buffer. Minimal replacement for the abandoned
 * `text2png` package - used for error images.
 */
function renderTextToPng(text, opts = {}) {
  const { padding = 10, backgroundColor = '#fff', color = '#000', font = DEFAULT_FONT } = opts;
  const lines = String(text).split('\n');

  const measurer = createCanvas(1, 1).getContext('2d');
  measurer.font = font;
  const textWidth = Math.max(1, ...lines.map((line) => measurer.measureText(line).width));

  const width = Math.ceil(textWidth + padding * 2);
  const height = Math.ceil(lines.length * LINE_HEIGHT + padding * 2);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  lines.forEach((line, idx) => {
    ctx.fillText(line, padding, padding + idx * LINE_HEIGHT);
  });
  return canvas.toBuffer('image/png');
}

module.exports = {
  renderTextToPng,
};
