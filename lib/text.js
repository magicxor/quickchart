const { createCanvas } = require('canvas');

const DEFAULT_FONT = '14px sans-serif';
const LINE_HEIGHT = 20;

// Bounds for the rendered error image. The input text is user-controlled
// (e.g. an arbitrarily long invalid chart config echoed in an error), so the
// canvas allocation must stay bounded regardless of input size.
const MAX_LINES = 40;
const MAX_LINE_LENGTH = 500;
const MAX_CANVAS_WIDTH = 2000;
const MAX_CANVAS_HEIGHT = 1000;

/**
 * Renders plain text to a PNG buffer. Minimal replacement for the abandoned
 * `text2png` package - used for error images.
 */
function renderTextToPng(text, opts = {}) {
  const { padding = 10, backgroundColor = '#fff', color = '#000', font = DEFAULT_FONT } = opts;
  const lines = String(text)
    .split('\n')
    .slice(0, MAX_LINES)
    .map((line) => (line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}...` : line));

  const measurer = createCanvas(1, 1).getContext('2d');
  measurer.font = font;
  const textWidth = Math.max(1, ...lines.map((line) => measurer.measureText(line).width));

  const width = Math.min(MAX_CANVAS_WIDTH, Math.ceil(textWidth + padding * 2));
  const height = Math.min(MAX_CANVAS_HEIGHT, Math.ceil(lines.length * LINE_HEIGHT + padding * 2));
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
