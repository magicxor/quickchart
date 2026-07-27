/**
 * Canvas proportions for a chart whose size the caller left open.
 *
 * `width` and `height` are optional: whichever is missing is derived from the
 * proportions of what is being drawn, and when both are missing the longest
 * side is `CHART_DEFAULT_SIZE` (1280) and the other follows. A map then lands
 * on a canvas shaped like the map - Russia landscape, Chile portrait - instead
 * of on whatever square the caller happened to guess.
 *
 * Geo charts have real proportions, measured from their projection (see
 * `measureAspectRatio`). Everything else gets the ratio its chart type is
 * usually read at.
 */
/**
 * A pixel length from configuration, or `fallback` when it is not one.
 *
 * These values are operator-set and are then used as arithmetic, so anything
 * unusable has to stop here rather than propagate: `Number()` alone takes
 * "-500" for a length and turns "3000px" into NaN, which reaches node-canvas
 * as a canvas size and fails there with nothing to say about the cause.
 */
function parsePixelSize(value, fallback) {
  const configured = Number(value);
  return Number.isFinite(configured) && configured >= 1 ? Math.round(configured) : fallback;
}

const DEFAULT_LONG_SIDE = parsePixelSize(process.env.CHART_DEFAULT_SIZE, 1280);

const LANDSCAPE = 16 / 9;
const SQUARE = 1;

// Chart types whose canvas is not square by default. Everything absent from
// this table - pie, doughnut, radar, polarArea, venn, wordCloud, the geo charts
// that could not be measured - is square.
const TYPE_RATIOS = new Map([
  ['bar', LANDSCAPE],
  ['line', LANDSCAPE],
  ['scatter', LANDSCAPE],
  ['bubble', LANDSCAPE],
  ['boxplot', LANDSCAPE],
  ['violin', LANDSCAPE],
  ['horizontalBoxplot', LANDSCAPE],
  ['horizontalViolin', LANDSCAPE],
  ['barWithErrorBars', LANDSCAPE],
  ['lineWithErrorBars', LANDSCAPE],
  ['scatterWithErrorBars', LANDSCAPE],
  ['funnel', LANDSCAPE],
  ['graph', LANDSCAPE],
  ['forceDirectedGraph', LANDSCAPE],
  ['dendrogram', LANDSCAPE],
  ['tree', LANDSCAPE],
  ['pcp', LANDSCAPE],
  ['logarithmicPcp', LANDSCAPE],
  // Strips rather than charts: a sparkline sits in a line of text, a progress
  // bar is a bar and its label.
  ['sparkline', 4],
  ['progressBar', 6],
]);

function ratioForType(type) {
  return TYPE_RATIOS.get(type) || SQUARE;
}

function isGivenSize(value) {
  return value !== undefined && value !== null && value !== '';
}

function clamp(value, max) {
  return Math.max(1, Math.min(max, Math.round(value)));
}

/**
 * Fills in whichever of `width`/`height` the caller omitted.
 *
 * `ratio` is the width/height of the *content*; `chrome` is what the canvas
 * spends on title, legend and padding rather than on the content, so that the
 * plot area - not the canvas - ends up with the requested proportions. Sizes
 * the caller did give are returned untouched; a derived side is clamped to the
 * configured maximum, which just letterboxes the result rather than failing.
 */
function resolveCanvasSize({ width, height, ratio, chrome, maxWidth, maxHeight, longSide }) {
  const hasWidth = isGivenSize(width);
  const hasHeight = isGivenSize(height);
  if (hasWidth && hasHeight) {
    return { width: Number(width), height: Number(height) };
  }

  const shape = Number.isFinite(ratio) && ratio > 0 ? ratio : SQUARE;
  const spare = { w: (chrome && chrome.w) || 0, h: (chrome && chrome.h) || 0 };
  const target = Number.isFinite(longSide) && longSide > 0 ? longSide : DEFAULT_LONG_SIDE;

  const heightFor = (canvasWidth) => (canvasWidth - spare.w) / shape + spare.h;
  const widthFor = (canvasHeight) => (canvasHeight - spare.h) * shape + spare.w;

  // One side given: it is honoured as asked, and the derived side is clamped -
  // an extreme ratio letterboxes rather than failing.
  if (hasWidth) {
    return { width: Number(width), height: clamp(heightFor(Number(width)), maxHeight) };
  }
  if (hasHeight) {
    return { width: clamp(widthFor(Number(height)), maxWidth), height: Number(height) };
  }

  // Neither given: the longest side is the target and the other follows. Here
  // both sides are ours, so a maximum below the target shrinks the canvas along
  // the ratio instead of reshaping it.
  let canvasWidth = shape >= 1 ? Math.min(target, maxWidth) : widthFor(Math.min(target, maxHeight));
  let canvasHeight = heightFor(canvasWidth);
  if (canvasHeight > maxHeight) {
    canvasHeight = maxHeight;
    canvasWidth = widthFor(canvasHeight);
  }
  if (canvasWidth > maxWidth) {
    canvasWidth = maxWidth;
    canvasHeight = heightFor(canvasWidth);
  }
  return { width: clamp(canvasWidth, maxWidth), height: clamp(canvasHeight, maxHeight) };
}

module.exports = {
  DEFAULT_LONG_SIDE,
  isGivenSize,
  parsePixelSize,
  ratioForType,
  resolveCanvasSize,
};
