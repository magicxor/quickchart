/* eslint-env node, mocha */

const assert = require('assert');

const { renderChartJs } = require('../../lib/charts');
const { Chart } = require('../../lib/chartjs');
const { defaultFormatter } = require('../../lib/datalabels');
const { ChartInputError } = require('../../lib/errors');
const { getMap, matchFeature } = require('../../lib/maps');
const { compileFunctionStrings } = require('../../lib/scriptable');

// A datalabels formatter context, of which the formatter uses the chart type,
// the dataset (for mixed charts) and `indexAxis`.
function context(type, indexAxis) {
  return {
    dataset: {},
    dataIndex: 0,
    datasetIndex: 0,
    chart: { config: { type }, options: { indexAxis: indexAxis || 'x' } },
  };
}

describe('datalabels default formatter', () => {
  it('is installed as the plugin default', () => {
    assert.strictEqual(Chart.defaults.plugins.datalabels.formatter, defaultFormatter);
  });

  it('labels a choropleth row with its feature name and value', () => {
    const row = { feature: matchFeature('blr', 'Brest'), value: 1348 };
    assert.deepStrictEqual(defaultFormatter(row, context('choropleth')), ['Brest', '1348']);
  });

  it('prefers a row label over the feature name', () => {
    const row = { feature: matchFeature('blr', 'Brest'), label: 'Брестская', value: 1348 };
    assert.deepStrictEqual(defaultFormatter(row, context('choropleth')), ['Брестская', '1348']);
  });

  it('falls back to a feature id when the feature has no name', () => {
    const feature = { type: 'Feature', id: 'DE.BE', properties: {} };
    assert.deepStrictEqual(defaultFormatter({ feature, value: 3 }, context('choropleth')), [
      'DE.BE',
      '3',
    ]);
  });

  it('returns a single line when a choropleth row has only one of name/value', () => {
    const feature = matchFeature('blr', 'Brest');
    assert.strictEqual(defaultFormatter({ feature }, context('choropleth')), 'Brest');
    assert.strictEqual(defaultFormatter({ value: 7 }, context('choropleth')), '7');
    assert.strictEqual(defaultFormatter({}, context('choropleth')), null);
  });

  it('labels a bubbleMap row with its value, not its coordinates', () => {
    const row = { longitude: 27.56, latitude: 53.9, value: 1996 };
    assert.strictEqual(defaultFormatter(row, context('bubbleMap')), '1996');
    assert.deepStrictEqual(defaultFormatter({ ...row, label: 'Минск' }, context('bubbleMap')), [
      'Минск',
      '1996',
    ]);
  });

  it('labels an {x, y} point with its value-axis coordinate', () => {
    assert.strictEqual(defaultFormatter({ x: 2, y: 14 }, context('line')), '14');
    assert.strictEqual(defaultFormatter({ x: 2, y: 14 }, context('scatter')), '14');
    // indexAxis 'y' puts the category on y and the value on x.
    assert.strictEqual(defaultFormatter({ x: 2, y: 'Cats' }, context('bar', 'y')), '2');
  });

  it('keeps the plugin behavior for bubble radius, labels and primitives', () => {
    assert.strictEqual(defaultFormatter({ x: 2, y: 14, r: 8 }, context('bubble')), '8');
    assert.strictEqual(defaultFormatter({ label: 'Dogs', y: 3 }, context('bar')), 'Dogs');
    assert.strictEqual(defaultFormatter(42, context('bar')), '42');
    assert.strictEqual(defaultFormatter(0, context('bar')), '0');
    assert.strictEqual(defaultFormatter('text', context('bar')), 'text');
    assert.strictEqual(defaultFormatter(null, context('bar')), null);
    assert.strictEqual(defaultFormatter(undefined, context('bar')), null);
    // An array is a datum in its own right (boxplot/violin), not a field bag.
    assert.strictEqual(defaultFormatter([1, 2, 3], context('boxplot')), '1,2,3');
  });

  it('lists the primitive members of an unrecognized object shape', () => {
    assert.strictEqual(
      defaultFormatter({ min: 1, q1: 2, median: 3 }, context('boxplot')),
      'min: 1, q1: 2, median: 3',
    );
  });

  it('never renders an object member as "[object Object]"', () => {
    const nested = { feature: { properties: { name: 'x' } }, extra: { a: 1 } };
    assert.strictEqual(defaultFormatter(nested, context('bar')), null);
    const rows = [
      { feature: matchFeature('blr', 'Minsk'), value: 1471 },
      { x: 1, y: 2 },
      { longitude: 1, latitude: 2, value: 3 },
    ];
    ['choropleth', 'bubbleMap', 'line', 'bar'].forEach((type) => {
      rows.forEach((row) => {
        const label = [defaultFormatter(row, context(type))].flat().join(' ');
        assert(!label.includes('[object'), `${type} labelled a row as "${label}"`);
      });
    });
  });
});

describe('quoted function options', () => {
  it('compiles a function expression string', () => {
    const chart = {
      options: { plugins: { datalabels: { formatter: 'function(v) { return v.y; }' } } },
    };
    compileFunctionStrings(chart);
    const { formatter } = chart.options.plugins.datalabels;
    assert.strictEqual(typeof formatter, 'function');
    assert.strictEqual(formatter({ y: 5 }), 5);
  });

  it('compiles arrow functions, named and async ones', () => {
    const chart = {
      options: {
        plugins: {
          datalabels: { display: '(ctx) => ctx.dataIndex > 0', color: 'v => "red"' },
          tooltip: { callbacks: { label: 'function label(item) { return item.formattedValue; }' } },
        },
        scales: { y: { ticks: { callback: 'async function(v) { return v; }' } } },
      },
    };
    compileFunctionStrings(chart);
    assert.strictEqual(chart.options.plugins.datalabels.display({ dataIndex: 1 }), true);
    assert.strictEqual(chart.options.plugins.datalabels.color(), 'red');
    assert.strictEqual(typeof chart.options.plugins.tooltip.callbacks.label, 'function');
    assert.strictEqual(typeof chart.options.scales.y.ticks.callback, 'function');
  });

  it('compiles scriptable dataset options', () => {
    const chart = {
      data: {
        datasets: [
          {
            label: 'Dogs',
            backgroundColor: 'function(ctx) { return ctx.raw > 0 ? "green" : "red"; }',
            data: [1, 2],
          },
        ],
      },
    };
    compileFunctionStrings(chart);
    assert.strictEqual(typeof chart.data.datasets[0].backgroundColor, 'function');
    assert.strictEqual(chart.data.datasets[0].backgroundColor({ raw: 1 }), 'green');
  });

  it('leaves ordinary text alone', () => {
    const chart = {
      data: {
        labels: ['x => y', 'function of time'],
        datasets: [{ label: 'Продажи (шт)', data: [{ label: 'x => y', y: 1 }] }],
      },
      options: {
        plugins: {
          title: { text: 'function of time' },
          datalabels: { formatter: 'value', align: 'end', anchor: 'end' },
        },
      },
    };
    const before = JSON.parse(JSON.stringify(chart));
    compileFunctionStrings(chart);
    assert.deepStrictEqual(chart, before);
  });

  it('leaves real functions and other values untouched', () => {
    const formatter = (v) => v.y;
    const chart = { options: { plugins: { datalabels: { formatter, display: true, offset: 4 } } } };
    compileFunctionStrings(chart);
    assert.strictEqual(chart.options.plugins.datalabels.formatter, formatter);
    assert.strictEqual(chart.options.plugins.datalabels.display, true);
    assert.strictEqual(chart.options.plugins.datalabels.offset, 4);
  });

  it('rejects a function string that does not parse, naming the option', () => {
    const chart = {
      options: { plugins: { datalabels: { formatter: 'function(v) { return v.y; ' } } },
    };
    assert.throws(
      () => compileFunctionStrings(chart),
      (err) =>
        err instanceof ChartInputError &&
        err.statusCode === 400 &&
        err.message.includes('options.plugins.datalabels.formatter'),
    );
  });

  it('tolerates configs that are not objects', () => {
    assert.doesNotThrow(() => {
      compileFunctionStrings(null);
      compileFunctionStrings('bar');
      compileFunctionStrings([1, 2]);
    });
  });
});

describe('labelled charts render', () => {
  it('labels choropleth regions from a config with no functions in it', async () => {
    const chart = {
      type: 'choropleth',
      data: {
        datasets: [
          {
            label: 'Население',
            map: 'blr',
            data: [
              { feature: 'Minsk', label: 'Минская', value: 1471 },
              { feature: 'Brest', label: 'Брестская', value: 1348 },
            ],
          },
        ],
      },
      options: {
        plugins: { datalabels: { color: 'black', font: { size: 12 } } },
        scales: { color: { axis: 'x', interpolate: 'Blues' } },
      },
    };
    const buf = await renderChartJs(500, 400, 'white', 1.0, undefined, 'png', chart);
    assert(buf.length > 0);
    // The extra `label` key must survive feature resolution for the formatter.
    assert.strictEqual(chart.data.datasets[0].data[0].label, 'Минская');
    assert.strictEqual(typeof chart.data.datasets[0].data[0].feature, 'object');
  });

  it('honors a quoted formatter through a full render', async () => {
    const chart = {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'S',
            data: [
              { x: 1, y: 10 },
              { x: 2, y: 14 },
            ],
          },
        ],
      },
      options: {
        scales: { x: { type: 'linear' } },
        plugins: { datalabels: { formatter: 'function(value) { return value.y + " шт"; }' } },
      },
    };
    const buf = await renderChartJs(400, 300, 'white', 1.0, undefined, 'png', chart);
    assert(buf.length > 0);
    // renderChartJs mutates its input: the string became a callable.
    const { formatter } = chart.options.plugins.datalabels;
    assert.strictEqual(typeof formatter, 'function');
    assert.strictEqual(formatter({ y: 14 }), '14 шт');
  });

  it('keeps datalabels off by default for geo charts', async () => {
    const chart = {
      type: 'choropleth',
      data: { datasets: [{ map: 'blr', data: [{ feature: 'Minsk', value: 1 }] }] },
    };
    await renderChartJs(300, 200, 'white', 1.0, undefined, 'png', chart);
    assert.strictEqual(chart.options.plugins.datalabels.display, false);
  });

  it('does not walk inline map geometry', () => {
    // A world outline is ~4000 coordinate rings; the walk must skip them.
    const chart = {
      type: 'choropleth',
      data: { datasets: [{ outline: getMap('world').features, data: [] }] },
    };
    const started = process.hrtime.bigint();
    compileFunctionStrings(chart);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert(elapsedMs < 50, `walking an inline world outline took ${elapsedMs}ms`);
  });
});
