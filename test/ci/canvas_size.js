/* eslint-env node, mocha */

const assert = require('assert');

const { imageSize } = require('image-size');

const {
  DEFAULT_LONG_SIDE,
  parsePixelSize,
  ratioForType,
  resolveCanvasSize,
} = require('../../lib/canvas');
const { renderChartJs } = require('../../lib/charts');
const { ChartInputError } = require('../../lib/errors');
const { getMap, getMapGeography } = require('../../lib/maps');
const { measureAspectRatio } = require('../../lib/projection');

const MAX = { maxWidth: 3000, maxHeight: 3000 };

function sizeOf(buffer) {
  const { width, height } = imageSize(buffer);
  return { width, height };
}

function mapChart(map, extra) {
  return {
    type: 'choropleth',
    data: {
      datasets: [
        {
          label: 'Value',
          map,
          borderWidth: 1,
          outlineBackgroundColor: '#e0e0e0',
          data: [],
        },
      ],
    },
    options: {
      plugins: { legend: { display: false }, datalabels: { display: false } },
      scales: { color: { axis: 'x', display: false } },
      ...extra,
    },
  };
}

describe('canvas sizing', () => {
  it('measures a map through the projection it is drawn with', () => {
    const ratio = measureAspectRatio(getMap('rus').features, getMapGeography('rus').projection);
    // Russia is drawn wider than tall, and would be near-square unprojected.
    assert(ratio > 1.6 && ratio < 2, `expected a landscape ratio, got ${ratio}`);
    const chile = measureAspectRatio(getMap('chl').features, getMapGeography('chl').projection);
    assert(chile < 1, `expected a portrait-ish ratio for Chile, got ${chile}`);
  });

  it('returns null rather than a ratio it cannot measure', () => {
    assert.strictEqual(measureAspectRatio(null, { type: 'equalEarth' }), null);
    assert.strictEqual(measureAspectRatio(getMap('deu').features, { type: 'nope' }), null);
  });

  it('keeps both dimensions the caller gave', () => {
    assert.deepStrictEqual(resolveCanvasSize({ width: 640, height: 480, ratio: 2, ...MAX }), {
      width: 640,
      height: 480,
    });
  });

  it('derives the missing dimension from the ratio', () => {
    assert.deepStrictEqual(resolveCanvasSize({ width: 800, ratio: 2, ...MAX }), {
      width: 800,
      height: 400,
    });
    assert.deepStrictEqual(resolveCanvasSize({ height: 800, ratio: 0.5, ...MAX }), {
      width: 400,
      height: 800,
    });
  });

  it('puts the long side on the default when neither is given', () => {
    const landscape = resolveCanvasSize({ ratio: 2, longSide: 1280, ...MAX });
    assert.deepStrictEqual(landscape, { width: 1280, height: 640 });
    const portrait = resolveCanvasSize({ ratio: 0.5, longSide: 1280, ...MAX });
    assert.deepStrictEqual(portrait, { width: 640, height: 1280 });
  });

  it('accounts for chrome so the plot area gets the ratio, not the canvas', () => {
    const size = resolveCanvasSize({ ratio: 2, chrome: { w: 100, h: 50 }, longSide: 1280, ...MAX });
    assert.strictEqual(size.width, 1280);
    // Plot area is 1180 x 590 - exactly 2:1 - plus the 50px of chrome.
    assert.strictEqual(size.height, 640);
  });

  it('clamps a derived side instead of failing', () => {
    const size = resolveCanvasSize({ width: 3000, ratio: 0.05, maxWidth: 3000, maxHeight: 3000 });
    assert.strictEqual(size.height, 3000);
  });

  it('shrinks along the ratio when the maximum is below the target', () => {
    // Both sides are ours to choose here, so a maximum smaller than
    // CHART_DEFAULT_SIZE must shrink the canvas, not reshape it.
    const landscape = resolveCanvasSize({
      ratio: 16 / 9,
      longSide: 4000,
      maxWidth: 3000,
      maxHeight: 3000,
    });
    assert.deepStrictEqual(landscape, { width: 3000, height: 1688 });

    const portrait = resolveCanvasSize({
      ratio: 0.5,
      longSide: 4000,
      maxWidth: 3000,
      maxHeight: 3000,
    });
    assert.deepStrictEqual(portrait, { width: 1500, height: 3000 });

    // A maximum that bites on the derived side rather than the long one.
    const wide = resolveCanvasSize({ ratio: 4, longSide: 2000, maxWidth: 2000, maxHeight: 400 });
    assert.deepStrictEqual(wide, { width: 1600, height: 400 });
  });

  it('knows which chart types are read landscape', () => {
    assert.strictEqual(ratioForType('line'), 16 / 9);
    assert.strictEqual(ratioForType('bar'), 16 / 9);
    assert.strictEqual(ratioForType('pie'), 1);
    assert.strictEqual(ratioForType('radar'), 1);
    assert.strictEqual(ratioForType('wordCloud'), 1);
    assert.strictEqual(ratioForType('sparkline'), 4);
    assert.strictEqual(DEFAULT_LONG_SIDE, 1280);
  });

  it('sizes a map chart from the map', async () => {
    const russia = sizeOf(
      await renderChartJs(undefined, undefined, 'white', 1, undefined, 'png', mapChart('rus')),
    );
    assert.strictEqual(russia.width, 1280);
    assert(russia.height < 900, `expected a landscape canvas, got ${JSON.stringify(russia)}`);

    const germany = sizeOf(
      await renderChartJs(undefined, undefined, 'white', 1, undefined, 'png', mapChart('deu')),
    );
    assert.strictEqual(germany.height, 1280);
    assert(germany.width < 1100, `expected a portrait canvas, got ${JSON.stringify(germany)}`);
  });

  it('sizes a cropped map from the crop, not from the whole map', async () => {
    const europe = sizeOf(
      await renderChartJs(
        undefined,
        undefined,
        'white',
        1,
        undefined,
        'png',
        mapChart('world', { scales: { projection: { axis: 'x', fit: [-25, 34, 45, 72] } } }),
      ),
    );
    // The whole world is 2:1; Europe alone is much closer to square.
    assert(
      europe.width / europe.height < 1.7,
      `expected the crop to drive the canvas, got ${JSON.stringify(europe)}`,
    );
  });

  it('sizes an ordinary chart by its type', async () => {
    const chart = { type: 'bar', data: { labels: ['a'], datasets: [{ data: [1] }] } };
    const bar = sizeOf(
      await renderChartJs(undefined, undefined, 'white', 1, undefined, 'png', chart),
    );
    assert.deepStrictEqual(bar, { width: 1280, height: 720 });

    const pieChart = { type: 'pie', data: { labels: ['a'], datasets: [{ data: [1] }] } };
    const pie = sizeOf(
      await renderChartJs(undefined, undefined, 'white', 1, undefined, 'png', pieChart),
    );
    assert.deepStrictEqual(pie, { width: 1280, height: 1280 });
  });

  it('sizes a QuickChart type by what was asked for, not what it becomes', async () => {
    // sparkline renders as a line and progressBar as a bar, but neither is read
    // at 16:9, so the ratio has to come from the type the caller named.
    const sparkline = sizeOf(
      await renderChartJs(undefined, undefined, 'white', 1, undefined, 'png', {
        type: 'sparkline',
        data: { datasets: [{ data: [1, 5, 3, 9, 4] }] },
      }),
    );
    assert.deepStrictEqual(sparkline, { width: 1280, height: 320 });

    const progress = sizeOf(
      await renderChartJs(undefined, undefined, 'white', 1, undefined, 'png', {
        type: 'progressBar',
        data: { datasets: [{ data: [80] }] },
      }),
    );
    assert.deepStrictEqual(progress, { width: 1280, height: 213 });
  });

  it('completes a partially given size', async () => {
    const chart = { type: 'line', data: { labels: ['a'], datasets: [{ data: [1] }] } };
    const wide = sizeOf(await renderChartJs(900, undefined, 'white', 1, undefined, 'png', chart));
    assert.deepStrictEqual(wide, { width: 900, height: 506 });
    const tall = sizeOf(await renderChartJs(undefined, 400, 'white', 1, undefined, 'png', chart));
    assert.deepStrictEqual(tall, { width: 711, height: 400 });
  });

  it('still rejects a size that is given but nonsense', async () => {
    const chart = { type: 'bar', data: { labels: ['a'], datasets: [{ data: [1] }] } };
    for (const bad of [0, -100, 250.5, Number.NaN, 99999]) {
      // eslint-disable-next-line no-await-in-loop
      await assert.rejects(
        () => renderChartJs(bad, undefined, 'white', 1, undefined, 'png', { ...chart }),
        (err) => err instanceof ChartInputError,
        `width ${bad} should have been rejected`,
      );
    }
  });

  it('falls back for a configured length that is not one', () => {
    // CHART_DEFAULT_SIZE and CHART_MAX_WIDTH/HEIGHT all come from the
    // environment and are all used as arithmetic.
    assert.strictEqual(parsePixelSize('2000', 1280), 2000);
    assert.strictEqual(parsePixelSize(2000.4, 1280), 2000);
    const bad = ['-500', -500, '0', 0, 0.5, 'abc', '3000px', '', null, undefined, Number.NaN];
    for (const value of bad) {
      assert.strictEqual(parsePixelSize(value, 1280), 1280, `${value} should have fallen back`);
      assert.strictEqual(parsePixelSize(value, 3000), 3000, `${value} should have fallen back`);
    }
  });
});
