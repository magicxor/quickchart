/**
 * Room for the label ink a chart draws outside its plot area.
 *
 * chart.js lays a canvas out as boxes around the plot - title, legend, axes -
 * and hands the plot everything that remains. Nothing in that arithmetic knows
 * about chartjs-plugin-annotation labels or chartjs-plugin-datalabels: their
 * ink is anchored to data positions but sized in pixels, so a callout flag
 * over the top-most point of a timeline lands *outside* the plot, where no
 * room was set aside for it. The annotation plugin then clips it against the
 * plot area (its `clip` default), and whatever escapes that is cut off by the
 * canvas edge - or, with `clip: false`, drawn straight over the title. Growing
 * the canvas cannot help: the plot grows with it and the flags travel along.
 *
 * This module is the missing arithmetic. `annotationInkOverflows` and
 * `dataLabelInkOverflows` read how far the drawn labels actually reach beyond
 * the plot of a laid-out chart, and the plugin from `createRoomPlugin` holds
 * that much space open as invisible spacer boxes between the plot and its
 * neighbours. `buildChartWithLabelRoom` ties the two together: lay out,
 * measure, widen the spacers, lay out again - the ink moves with the plot, so
 * a few passes settle it.
 */
const { layouts } = require('chart.js');
const annotationPlugin = require('chartjs-plugin-annotation');

// What reserving room may never take from the plot: label room comes out of
// the plot area, and a plot reduced to nothing is a worse failure than a
// clipped label. Ink that has no room left under this floor is drawn as far
// as the room goes and cut where it always was - and ink that could never fit
// (a box annotation reaching to y=1e9, pixels off-scale by thousands) is
// recognized in `buildChartWithLabelRoom` and keeps today's clipped look.
const MIN_PLOT_FRACTION = 1 / 4;

// chart.js places boxes by weight, higher weights further from the plot
// (title 2000, legend 1000, scales 0). The spacers must be the innermost
// boxes of their side - the room they hold open is for ink hanging off the
// plot itself, so nothing may stand between the two.
const SPACER_WEIGHT = -1000;

// Passes of lay-out/measure/reserve in `buildChartWithLabelRoom`. Reserving
// moves the plot edges, and with them the ink anchored to data positions, so
// one measurement is an estimate that the next pass corrects - see the growth
// model there. The budget caps every step, so a chart this cannot settle
// leaves with the last (still budget-shaped) room rather than degenerating.
const MAX_PASSES = 5;

// How much of a pass's leftover gap the next reserve may treat as recurring.
// 1/(1 - k) below diverges as k approaches 1; at this clamp one pass jumps at
// most 10x the gap. Ink the plot cannot move away from at all asks for more
// than the axis holds and lands on the budget split instead, so a tighter
// clamp costs nothing there and keeps a noisy estimate from overshooting.
const MAX_GROWTH_FACTOR = 0.9;

const SIDES = ['top', 'right', 'bottom', 'left'];
const AXIS_OF_SIDE = { top: 'y', bottom: 'y', left: 'x', right: 'x' };

function zeroSides() {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Whether the config names any annotations, i.e. whether the annotation
 * plugin has anything to draw. Read the way the plugin itself reads it: an
 * object of annotations by id, or an array of them.
 */
function annotationsConfigured(chart) {
  const plugins = chart && chart.options ? chart.options.plugins : null;
  const options = plugins ? plugins.annotation : null;
  if (!isPlainObject(options)) {
    return false;
  }
  const { annotations } = options;
  if (Array.isArray(annotations)) {
    return annotations.some(isPlainObject);
  }
  return isPlainObject(annotations) && Object.keys(annotations).length > 0;
}

// An invisible, fixed-size layout box. `options` must exist: chart.js reads
// `box.options.stack` when grouping boxes for layout.
function spacerBox(position, horizontal, reserve) {
  return {
    options: {},
    position,
    weight: SPACER_WEIGHT,
    fullSize: false,
    isHorizontal: () => horizontal,
    update(maxWidth, maxHeight) {
      const size = Math.max(0, reserve[position] || 0);
      this.width = horizontal ? maxWidth : size;
      this.height = horizontal ? size : maxHeight;
    },
    draw() {},
  };
}

/**
 * A chart plugin holding `reserve` ({top, right, bottom, left} pixels) open
 * around the plot area. The reserve object is read live at every layout, so
 * the caller can widen it between passes and rebuild without reconfiguring.
 */
function createRoomPlugin(reserve) {
  return {
    id: 'labelRoom',
    beforeInit(chart) {
      layouts.addBox(chart, spacerBox('top', true, reserve));
      layouts.addBox(chart, spacerBox('bottom', true, reserve));
      layouts.addBox(chart, spacerBox('left', false, reserve));
      layouts.addBox(chart, spacerBox('right', false, reserve));
    },
  };
}

function emptyBounds() {
  return { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
}

function extendBounds(bounds, x, y) {
  bounds.left = Math.min(bounds.left, x);
  bounds.right = Math.max(bounds.right, x);
  bounds.top = Math.min(bounds.top, y);
  bounds.bottom = Math.max(bounds.bottom, y);
}

// How far `bounds` reach beyond the plot area, per side, in pixels >= 0.
// Because a spacer band starts at the plot edge, this is also directly the
// reserve that would contain the ink.
function overflowBeyond(bounds, area) {
  return {
    top: Math.max(0, area.top - bounds.top),
    right: Math.max(0, bounds.right - area.right),
    bottom: Math.max(0, bounds.bottom - area.bottom),
    left: Math.max(0, area.left - bounds.left),
  };
}

/**
 * The pixel rectangle one annotation element inks, border and callout
 * included. Annotation elements are box-shaped - label, box, ellipse, point,
 * polygon and the line all carry {x, y, x2, y2} - and a rotated one still
 * reaches at most to its rotated corners. Returns null for an element whose
 * geometry does not read that way (a doughnutLabel, a future type): it stays
 * unmeasured rather than guessed at, i.e. it keeps today's behavior.
 */
function annotationBounds(element) {
  const options = element.options || {};
  const x2 = isFiniteNumber(element.x2) ? element.x2 : element.x + (element.width || 0);
  const y2 = isFiniteNumber(element.y2) ? element.y2 : element.y + (element.height || 0);
  if (
    !isFiniteNumber(element.x) ||
    !isFiniteNumber(element.y) ||
    !isFiniteNumber(x2) ||
    !isFiniteNumber(y2)
  ) {
    return null;
  }

  let corners = [
    { x: element.x, y: element.y },
    { x: x2, y: element.y },
    { x: x2, y: y2 },
    { x: element.x, y: y2 },
  ];
  const rotation = isFiniteNumber(element.rotation) ? element.rotation : options.rotation;
  if (isFiniteNumber(rotation) && rotation % 360 !== 0) {
    const angle = (rotation * Math.PI) / 180;
    const cx = isFiniteNumber(element.centerX) ? element.centerX : (element.x + x2) / 2;
    const cy = isFiniteNumber(element.centerY) ? element.centerY : (element.y + y2) / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    corners = corners.map(({ x, y }) => ({
      x: cx + (x - cx) * cos - (y - cy) * sin,
      y: cy + (x - cx) * sin + (y - cy) * cos,
    }));
  }

  const bounds = emptyBounds();
  corners.forEach(({ x, y }) => extendBounds(bounds, x, y));

  const borderWidth = isFiniteNumber(options.borderWidth) ? options.borderWidth : 0;
  bounds.left -= borderWidth / 2;
  bounds.top -= borderWidth / 2;
  bounds.right += borderWidth / 2;
  bounds.bottom += borderWidth / 2;

  // A callout runs from the label border to its anchor point.
  const callout = options.callout;
  if (
    callout &&
    callout.display &&
    isFiniteNumber(element.pointX) &&
    isFiniteNumber(element.pointY)
  ) {
    extendBounds(bounds, element.pointX, element.pointY);
  }
  return bounds;
}

/**
 * Per drawn annotation part, how far its ink reaches beyond the plot area.
 * Measured from the laid-out elements - a line's label and a box's label ride
 * along in `element.elements` and count as parts of their own.
 */
function annotationInkOverflows(chart) {
  const overflows = [];
  annotationPlugin.getAnnotations(chart).forEach((element) => {
    if (element.skip || !element.options || !element.options.display) {
      return;
    }
    const parts = [element];
    (element.elements || []).forEach((sub) => {
      if (sub && sub.options && sub.options.display) {
        parts.push(sub);
      }
    });
    parts.forEach((part) => {
      const bounds = annotationBounds(part);
      if (bounds) {
        overflows.push(overflowBeyond(bounds, chart.chartArea));
      }
    });
  });
  return overflows;
}

/**
 * Per drawn data label, how far its ink reaches beyond the plot area.
 *
 * Reads chartjs-plugin-datalabels' per-chart state (`$datalabels`, see its
 * source): the hit box its layout keeps per label is the drawn frame -
 * padding, border and rotation included - positioned on the canvas. Labels
 * the plugin will not draw outside the plot contribute nothing: hidden ones,
 * and ones with `clip: true`, which the plugin cuts against the plot area
 * itself. Anything shaped unexpectedly is skipped, not guessed at.
 */
function dataLabelInkOverflows(chart) {
  const overflows = [];
  const expando = chart.$datalabels;
  const labels = (expando && expando._labels) || [];
  labels.forEach((label) => {
    const state = label && label.$layout;
    if (!state || !state._visible || typeof label.model !== 'function') {
      return;
    }
    const model = label.model();
    if (!model || !model.opacity || model.clip) {
      return;
    }
    const box = state._box;
    if (!box || typeof box._points !== 'function') {
      return;
    }
    const bounds = emptyBounds();
    box._points().forEach(({ x, y }) => {
      if (isFiniteNumber(x) && isFiniteNumber(y)) {
        extendBounds(bounds, x, y);
      }
    });
    if (bounds.left <= bounds.right) {
      overflows.push(overflowBeyond(bounds, chart.chartArea));
    }
  });
  return overflows;
}

// How much total reserve each axis can afford: what title, legend, axes and
// padding leave of the canvas, minus the plot's guaranteed share. The chrome
// is read off the laid-out instance, as everything but plot and spacers.
function axisBudgets(instance, size, reserve) {
  const area = instance.chartArea;
  const chromeY = Math.max(
    0,
    size.height - (area.bottom - area.top) - reserve.top - reserve.bottom,
  );
  const chromeX = Math.max(0, size.width - (area.right - area.left) - reserve.left - reserve.right);
  return {
    y: Math.max(0, size.height - chromeY - size.height * MIN_PLOT_FRACTION),
    x: Math.max(0, size.width - chromeX - size.width * MIN_PLOT_FRACTION),
  };
}

/**
 * The room a set of ink overflows asks for, per side, and whether some piece
 * of ink could never be given room ("wild"). One wild piece does not spoil
 * the others: it is dropped from the asks - reserving its axis's whole budget
 * would crush the plot and still not show it - and reported, so the caller
 * can keep the annotation plugin's own clipping on rather than unleash it.
 */
function foldInkAsks(overflows, budgets) {
  const ask = zeroSides();
  let wild = false;
  overflows.forEach((overflow) => {
    if (SIDES.some((side) => overflow[side] > budgets[AXIS_OF_SIDE[side]])) {
      wild = true;
      return;
    }
    SIDES.forEach((side) => {
      ask[side] = Math.max(ask[side], overflow[side]);
    });
  });
  return { ask, wild };
}

/**
 * Builds the chart with room reserved for its label ink.
 *
 * `buildChart()` must construct a fresh, fully drawn chart.js instance from a
 * config that carries the plugin from `createRoomPlugin(reserve)`; each pass
 * here measures the ink of the last build, widens `reserve` where the ink
 * does not fit yet, and builds again. Returns the final instance, which the
 * caller owns (and destroys).
 *
 * The annotation plugin clips everything it draws against the plot area
 * unless configured otherwise. A caller who set `clip` has spoken - both ways
 * are honoured, and with `clip: false` the reserve keeps their ink off the
 * title as far as the budget goes. A caller who left it open gets the
 * engine's judgement: unclip exactly when some ink reaches outside and none
 * of it is beyond giving room to, so flag labels come out whole while a box
 * stretched far off-scale keeps today's clipped look. The decision is made
 * once, on the first layout, and written to the config so every later pass
 * draws the same way.
 */
function buildChartWithLabelRoom(chart, size, reserve, buildChart) {
  const plugins = chart.options ? chart.options.plugins : null;
  const annotationOptions =
    plugins && isPlainObject(plugins.annotation) ? plugins.annotation : null;

  // Reserving room moves the plot edge, and ink anchored to data positions
  // moves along - so part of every gap closed reappears on the next layout.
  // A flag hanging off the centre line of a timeline is the extreme case: the
  // centre barely moves when both sides reserve evenly, and the gap reappears
  // whole. Chasing that at one gap per pass converges too slowly to bound, so
  // the growth is modelled instead: with gaps g0, g1 from consecutive passes,
  // the recurring share is k = g1/g0, and the reserve that settles the side
  // is reserve + gap/(1 - k) - infinity, i.e. the axis budget, for ink the
  // plot cannot move away from.
  const lastGap = zeroSides();

  let instance = buildChart();
  for (let pass = 0; ; pass += 1) {
    const budgets = axisBudgets(instance, size, reserve);

    let annotationAsk = zeroSides();
    if (annotationOptions) {
      const { ask, wild } = foldInkAsks(annotationInkOverflows(instance), budgets);
      const reaches = SIDES.some((side) => ask[side] > 0);
      if (pass === 0 && annotationOptions.clip === undefined && !wild && reaches) {
        annotationOptions.clip = false;
      }
      if (annotationOptions.clip === false) {
        annotationAsk = ask;
      }
    }
    const labelAsk = foldInkAsks(dataLabelInkOverflows(instance), budgets).ask;

    // What each side needs: the reserve that would end the chase for a side
    // still short of room, the measured ink for one holding more than the ink
    // asks (an earlier estimate overshot - room shrinks back to its use).
    const inks = zeroSides();
    const needed = zeroSides();
    SIDES.forEach((side) => {
      const ink = Math.max(annotationAsk[side], labelAsk[side]);
      const gap = ink - reserve[side];
      inks[side] = ink;
      if (gap > 0.5) {
        const growth =
          lastGap[side] > 0 ? Math.min(MAX_GROWTH_FACTOR, Math.max(0, gap / lastGap[side])) : 0;
        needed[side] = reserve[side] + gap / (1 - growth);
      } else {
        needed[side] = ink;
      }
      lastGap[side] = Math.max(0, gap);
    });
    // Both sides of an axis draw on one budget. Asks beyond it are cut back
    // to a split proportional to the measured ink - the extrapolations that
    // overshot the budget say how fast sides were growing, not how much of
    // the room each one deserves.
    [
      ['top', 'bottom', 'y'],
      ['left', 'right', 'x'],
    ].forEach(([a, b, axis]) => {
      const budget = budgets[axis];
      if (needed[a] + needed[b] <= budget) {
        return;
      }
      const inkTotal = inks[a] + inks[b];
      let shareA = inkTotal > 0 ? (budget * inks[a]) / inkTotal : budget / 2;
      shareA = Math.min(shareA, needed[a]);
      const shareB = Math.min(budget - shareA, needed[b]);
      needed[a] = Math.min(needed[a], budget - shareB);
      needed[b] = shareB;
    });

    let settled = true;
    SIDES.forEach((side) => {
      if (Math.abs(needed[side] - reserve[side]) > 0.5) {
        reserve[side] = Math.round(needed[side]);
        settled = false;
      }
    });
    if (settled || pass >= MAX_PASSES - 1) {
      return instance;
    }
    instance.destroy();
    instance = buildChart();
  }
}

module.exports = {
  annotationsConfigured,
  buildChartWithLabelRoom,
  createRoomPlugin,
  annotationInkOverflows,
  dataLabelInkOverflows,
};
