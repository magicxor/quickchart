/* eslint-env node, mocha */

const assert = require('assert');

const getColors = require('get-image-colors');
const { imageSize } = require('image-size');

const chartsLib = require('../../lib/charts');
const charts = require('./chart_helpers');

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

describe('charts.js', () => {
  it('renders a JSON chart', async () => {
    const buf = await chartsLib.renderChartJs(
      200,
      100,
      'white',
      1.0,
      undefined,
      'png',
      clone(charts.BASIC_CHART),
    );

    assert(buf.length > 0);
    const dimensions = imageSize(buf);
    assert.equal(200, dimensions.width);
    assert.equal(100, dimensions.height);
  });

  it('ignores legacy chart.js versions and still renders', async () => {
    const buf = await chartsLib.renderChartJs(
      200,
      100,
      'white',
      1.0,
      '2.9.4',
      'png',
      clone(charts.BASIC_CHART),
    );

    assert(buf.length > 0);
    const dimensions = imageSize(buf);
    assert.equal(200, dimensions.width);
    assert.equal(100, dimensions.height);
  });

  it('adjusts chart size based on device pixel ratio', async () => {
    const buf = await chartsLib.renderChartJs(
      200,
      100,
      'white',
      2.0,
      undefined,
      'png',
      clone(charts.BASIC_CHART),
    );

    assert(buf.length > 0);
    const dimensions = imageSize(buf);
    // Device pixel ratio is 2.0, so multiply dimensions by that.
    assert.equal(200 * 2, dimensions.width);
    assert.equal(100 * 2, dimensions.height);
  });

  it('defaults to a 2.0 device pixel ratio', async () => {
    const buf = await chartsLib.renderChartJs(
      200,
      100,
      'white',
      undefined,
      undefined,
      'png',
      clone(charts.BASIC_CHART),
    );

    const dimensions = imageSize(buf);
    assert.equal(200 * 2, dimensions.width);
    assert.equal(100 * 2, dimensions.height);
  });

  it('renders a chart sent as a JSON string', async () => {
    const buf = await chartsLib.renderChartJs(
      200,
      100,
      'white',
      2.0,
      undefined,
      'png',
      JSON.stringify(charts.ADVANCED_CHART),
    );
    assert(buf.length > 0);
  });

  it('renders a violin chart', async () => {
    const buf = await chartsLib.renderChartJs(
      300,
      200,
      'white',
      2.0,
      undefined,
      'png',
      clone(charts.CHART_VIOLIN),
    );
    const dimensions = imageSize(buf);
    assert.equal(600, dimensions.width);
    assert.equal(400, dimensions.height);
  });

  it('renders a progress bar', async () => {
    const buf = await chartsLib.renderChartJs(
      500,
      50,
      'red',
      2.0,
      undefined,
      'png',
      clone(charts.CHART_PROGRESSBAR),
    );
    const colors = (await getColors(buf, 'image/png')).map((color) => color.rgb());
    // The progress bar track border defaults to the first Tableau color.
    const expected = [78, 120, 167];
    assert(
      colors.some(
        (rgb) =>
          Math.abs(rgb[0] - expected[0]) < 40 &&
          Math.abs(rgb[1] - expected[1]) < 40 &&
          Math.abs(rgb[2] - expected[2]) < 40,
      ),
      `expected a color similar to ${expected} in ${JSON.stringify(colors)}`,
    );
  });

  it('gives sparklines a y range that contains negative data', async () => {
    const chart = {
      type: 'sparkline',
      data: { datasets: [{ data: [-100, -50, -75] }] },
    };
    const buf = await chartsLib.renderChartJs(200, 100, 'white', 1.0, undefined, 'png', chart);
    assert(buf.length > 0);
    // renderChartJs mutates its input; the derived scale must contain the data.
    assert(chart.options.scales.y.min <= -100, `scale min ${chart.options.scales.y.min}`);
    assert(chart.options.scales.y.max >= -50, `scale max ${chart.options.scales.y.max}`);
  });

  it('renders a flat sparkline with a non-degenerate y range', async () => {
    const chart = {
      type: 'sparkline',
      data: { datasets: [{ data: [5, 5, 5] }] },
    };
    const buf = await chartsLib.renderChartJs(200, 100, 'white', 1.0, undefined, 'png', chart);
    assert(buf.length > 0);
    assert(chart.options.scales.y.min < chart.options.scales.y.max);
  });

  it('keeps user-provided labels on progress bars', async () => {
    const chart = clone(charts.CHART_PROGRESSBAR);
    chart.data.labels = ['My progress'];
    const buf = await chartsLib.renderChartJs(500, 50, 'red', 2.0, undefined, 'png', chart);
    assert(buf.length > 0);
    // renderChartJs mutates its input; the labels must survive the transform.
    assert.deepStrictEqual(['My progress'], chart.data.labels);
  });

  it('renders a datetime chart with the moment adapter', async () => {
    const buf = await chartsLib.renderChartJs(
      200,
      100,
      'white',
      1.0,
      undefined,
      'png',
      clone(charts.DATETIME_CHART),
    );

    assert(buf.length > 0);
    const dimensions = imageSize(buf);
    assert.equal(200, dimensions.width);
    assert.equal(100, dimensions.height);
  });

  it('renders a basic chart svg', async () => {
    const buf = await chartsLib.renderChartJs(
      500,
      300,
      'white',
      1.0,
      undefined,
      'svg',
      clone(charts.BASIC_CHART),
    );

    const svg = buf.toString();
    assert(svg.includes('<svg'), 'expected an <svg> root element');
    assert(svg.includes('<path'), 'expected vector path data');
    assert(svg.length > 1000, 'expected non-trivial svg output');
  });
});
