/* eslint-env node, mocha */

const assert = require('assert');

const { Jimp } = require('jimp');

const { renderChartJs } = require('../../lib/charts');
const { annotationsConfigured } = require('../../lib/labelroom');

const WIDTH = 500;
const HEIGHT = 400;

// The label ink every test paints red, against a chart that draws nothing
// else red: title and ticks are grey, the datasets get no visible points.
const RED = (r, g, b) => r > 180 && g < 90 && b < 90;

// A title of this font size occupies the rows above ~44px; label ink that
// keeps out of it starts below, and ink that lands on the title (the old
// clip: false failure) or is cut at the canvas edge starts above.
const TITLE_FONT = 20;
const TITLE_BOTTOM = 40;

/**
 * Renders the chart at 1:1 pixels and returns where its red ink landed: the
 * bounding box in canvas pixels, or null when no red was drawn at all (which
 * is what clipping a label away leaves behind).
 */
async function redInk(chart) {
  const buf = await renderChartJs(WIDTH, HEIGHT, '#ffffff', 1, '4', 'png', chart);
  const { bitmap } = await Jimp.read(buf);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const offset = (y * bitmap.width + x) * 4;
      if (RED(bitmap.data[offset], bitmap.data[offset + 1], bitmap.data[offset + 2])) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return minX === Infinity ? null : { left: minX, top: minY, right: maxX, bottom: maxY };
}

// The user-reported shape: a timeline drawn on the centre line of a hidden y
// scale, with a pixel-offset "flag" label annotation. `yAdjust` -180 puts the
// whole flag above the plot area a 400px canvas lays out, so without room
// reserved for it the annotation plugin clips it away entirely.
function flagChart(yAdjust, annotationOverrides, flagOverrides) {
  return {
    type: 'scatter',
    data: {
      datasets: [
        {
          data: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
          pointRadius: 0,
        },
      ],
    },
    options: {
      plugins: {
        title: { display: true, text: 'Заголовок', font: { size: TITLE_FONT } },
        legend: { display: false },
        annotation: {
          annotations: {
            flag: {
              type: 'label',
              xValue: 5,
              yValue: 0,
              yAdjust,
              content: 'Пик',
              backgroundColor: 'red',
              color: 'white',
              padding: 8,
              ...flagOverrides,
            },
          },
          ...annotationOverrides,
        },
      },
      scales: { x: { min: 0, max: 10 }, y: { display: false, min: -1, max: 1 } },
    },
  };
}

describe('room for annotation labels', () => {
  it('shows a flag that used to be clipped away above the plot', async () => {
    const chart = flagChart(-180);
    const ink = await redInk(chart);
    assert(ink, 'the flag was clipped away entirely');
    // Below the title, not over it, and not shaved by the canvas edge.
    assert(ink.top >= TITLE_BOTTOM, `flag ink starts at ${ink.top}, inside the title`);
    // The whole box made it: content line plus padding.
    assert(ink.bottom - ink.top >= 25, `only ${ink.bottom - ink.top}px of the flag is visible`);
    // The engine's decision is written to the config: the plugin's own
    // clipping is off, because the reserve provably contains the ink.
    assert.strictEqual(chart.options.plugins.annotation.clip, false);
  });

  it('keeps a flag below the plot off the x axis labels', async () => {
    const chart = flagChart(190);
    const ink = await redInk(chart);
    assert(ink, 'the flag was clipped away entirely');
    // Above the tick labels at the canvas bottom, with nothing shaved.
    assert(ink.bottom <= HEIGHT - 22, `flag ink reaches ${ink.bottom}, into the axis labels`);
    assert(ink.bottom - ink.top >= 25, `only ${ink.bottom - ink.top}px of the flag is visible`);
  });

  it('honours an explicit clip: true, ink and options both', async () => {
    const chart = flagChart(-180, { clip: true });
    const ink = await redInk(chart);
    assert.strictEqual(ink, null, 'clipped annotations must stay clipped');
    assert.strictEqual(chart.options.plugins.annotation.clip, true);
  });

  it('reserves room for an explicit clip: false instead of letting ink hit the title', async () => {
    const chart = flagChart(-180, { clip: false });
    const ink = await redInk(chart);
    assert(ink, 'the flag was not drawn');
    assert(ink.top >= TITLE_BOTTOM, `flag ink starts at ${ink.top}, inside the title`);
    assert.strictEqual(chart.options.plugins.annotation.clip, false);
  });

  it('leaves geometry that could never fit with today’s clipped look', async () => {
    // A box reaching six orders of magnitude past the scale: the pixels it
    // asks for are beyond any budget, so the plugin's own clipping stays on
    // and the box is cut at the plot edge, exactly as before.
    const chart = flagChart(-180, undefined, {
      type: 'box',
      xValue: undefined,
      yValue: undefined,
      yAdjust: undefined,
      content: undefined,
      xMin: 2,
      xMax: 8,
      yMin: 0.5,
      yMax: 1e6,
      borderColor: 'red',
    });
    const ink = await redInk(chart);
    assert(ink, 'the box should still be drawn inside the plot');
    assert(ink.top >= TITLE_BOTTOM, `box ink starts at ${ink.top}, outside the plot`);
    assert.strictEqual(chart.options.plugins.annotation.clip, undefined);
  });

  it('renders the reserved layout to svg as well', async () => {
    const buf = await renderChartJs(WIDTH, HEIGHT, '#ffffff', 1, '4', 'svg', flagChart(-180));
    assert(buf.toString('utf8').includes('<svg'));
  });
});

describe('room for data labels', () => {
  it('keeps a label pushed past the plot edge out of the title', async () => {
    const chart = {
      type: 'scatter',
      data: {
        datasets: [
          {
            data: [{ x: 5, y: 1 }],
            pointRadius: 0,
            datalabels: {
              display: true,
              align: 'top',
              offset: 30,
              backgroundColor: 'red',
              color: 'white',
            },
          },
        ],
      },
      options: {
        plugins: {
          title: { display: true, text: 'Заголовок', font: { size: TITLE_FONT } },
          legend: { display: false },
        },
        scales: { x: { min: 0, max: 10 }, y: { display: false, min: -1, max: 1 } },
      },
    };
    const ink = await redInk(chart);
    assert(ink, 'the label was not drawn');
    // datalabels never clipped this ink - it used to land on the title.
    assert(ink.top >= TITLE_BOTTOM, `label ink starts at ${ink.top}, inside the title`);
    assert(ink.bottom - ink.top >= 15, `only ${ink.bottom - ink.top}px of the label is visible`);
  });
});

describe('which charts take the measured passes', () => {
  const roomPluginAttached = (chart) =>
    Array.isArray(chart.plugins) && chart.plugins.some((plugin) => plugin.id === 'labelRoom');

  it('skips a chart with no annotations and no possible data labels', async () => {
    const chart = {
      type: 'bar',
      data: { labels: ['a', 'b'], datasets: [{ data: [1, 2] }] },
    };
    await renderChartJs(200, 150, '#ffffff', 1, '4', 'png', chart);
    assert.strictEqual(roomPluginAttached(chart), false);
  });

  it('measures a chart that names an annotation', async () => {
    const chart = flagChart(-180);
    await renderChartJs(200, 150, '#ffffff', 1, '4', 'png', chart);
    assert.strictEqual(roomPluginAttached(chart), true);
  });

  it('reads annotation configs the way the plugin does', () => {
    const of = (annotation) => ({ options: { plugins: { annotation } } });
    assert.strictEqual(annotationsConfigured(of({ annotations: { a: { type: 'label' } } })), true);
    assert.strictEqual(annotationsConfigured(of({ annotations: [{ type: 'box' }] })), true);
    assert.strictEqual(annotationsConfigured(of({ annotations: {} })), false);
    assert.strictEqual(annotationsConfigured(of({ annotations: [] })), false);
    assert.strictEqual(annotationsConfigured(of({ annotations: [null, 'x'] })), false);
    assert.strictEqual(annotationsConfigured(of({})), false);
    assert.strictEqual(annotationsConfigured(of(null)), false);
    assert.strictEqual(annotationsConfigured({ options: {} }), false);
    assert.strictEqual(annotationsConfigured({}), false);
  });
});
