/* eslint-env node, mocha */

const assert = require('assert');

const { renderChartJs } = require('../../lib/charts');
const { Chart } = require('../../lib/chartjs');
const { defaultFormatter, mayDrawDataLabels } = require('../../lib/datalabels');
const { ChartInputError } = require('../../lib/errors');
const { getMap, matchFeature } = require('../../lib/maps');
const { compileFunctionStrings } = require('../../lib/scriptable');

// A datalabels formatter context, of which the formatter uses the chart type,
// the dataset (for mixed charts), `indexAxis` and the category labels (funnel).
function context(type, indexAxis, labels) {
  return {
    dataset: {},
    dataIndex: 0,
    datasetIndex: 0,
    chart: { config: { type }, options: { indexAxis: indexAxis || 'x' }, data: { labels } },
  };
}

describe('datalabels default formatter', () => {
  it('is installed as the plugin default', () => {
    assert.strictEqual(Chart.defaults.plugins.datalabels.formatter, defaultFormatter);
  });

  it('is what a funnel uses, in place of the plugin percentage formatter', () => {
    // chartjs-chart-funnel's own formatter reads a stage as a fraction of 1 and
    // prints an absolute count of 600 as "60,000%".
    assert.strictEqual(Chart.overrides.funnel.plugins.datalabels.formatter, undefined);
  });

  it('labels a funnel stage with its name and value', () => {
    const labels = ['Клики', 'Корзина'];
    assert.deepStrictEqual(defaultFormatter(600, context('funnel', 'x', labels)), ['Клики', '600']);
    // Object data reaches the funnel controller through its bar parsing.
    assert.deepStrictEqual(defaultFormatter({ y: 600 }, context('funnel', 'x', labels)), [
      'Клики',
      '600',
    ]);
    // Unnamed stages keep the value alone rather than growing an empty line.
    assert.strictEqual(defaultFormatter(600, context('funnel')), '600');
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

  it('skips a mis-shaped member and labels with the next one that reads', () => {
    // An object where a number belongs must not become the label, but it must
    // not suppress a member that does read either.
    const feature = matchFeature('blr', 'Brest');
    assert.strictEqual(
      defaultFormatter({ feature, value: { n: 5 } }, context('choropleth')),
      'Brest',
    );
    assert.strictEqual(defaultFormatter({ label: { ru: 'Кошки' }, y: 3 }, context('bar')), '3');
    assert.strictEqual(defaultFormatter({ label: {}, value: {} }, context('bubbleMap')), null);
  });

  it('skips members that have no text form, rather than throwing on them', () => {
    // A JS config can hold anything; a symbol throws when concatenated, and a
    // function would print its whole source.
    const datum = { min: 1, tag: Symbol('q'), fn: () => 1, n: 10n, ok: true };
    assert.strictEqual(defaultFormatter(datum, context('boxplot')), 'min: 1, n: 10, ok: true');
  });

  it('never renders an object member as "[object Object]"', () => {
    const nested = { feature: { properties: { name: 'x' } }, extra: { a: 1 } };
    assert.strictEqual(defaultFormatter(nested, context('bar')), null);
    const rows = [
      { feature: matchFeature('blr', 'Minsk'), value: 1471 },
      { x: 1, y: 2 },
      { longitude: 1, latitude: 2, value: 3 },
      // Mis-shaped rows: data is whatever the caller sent.
      { feature: matchFeature('blr', 'Minsk'), value: { n: 5 } },
      { label: { ru: 'Кошки' }, y: 3 },
      { label: {}, value: {}, x: {}, y: {} },
    ];
    ['choropleth', 'bubbleMap', 'line', 'bar'].forEach((type) => {
      rows.forEach((row) => {
        const label = [defaultFormatter(row, context(type))].flat().join(' ');
        assert(!label.includes('[object'), `${type} labelled a row as "${label}"`);
      });
    });
  });
});

describe('whether labels can be drawn', () => {
  // As `prepareChart` asks it: after the QuickChart defaults, which is what
  // settles the question for a type that carries no labels of its own.
  const chart = (datalabels, datasets = [{}]) => ({
    data: { datasets },
    options: { plugins: { datalabels } },
  });

  it('says no only when the config settles it', () => {
    assert.strictEqual(mayDrawDataLabels(chart({ display: false })), false);
    // The two values chart.js reads as "plugin off", which no dataset can undo.
    assert.strictEqual(mayDrawDataLabels(chart(false)), false);
    assert.strictEqual(mayDrawDataLabels(chart(null)), false);
    assert.strictEqual(mayDrawDataLabels(chart(false, [{ datalabels: { display: true } }])), false);
    assert.strictEqual(mayDrawDataLabels(chart(null, [{ datalabels: { display: true } }])), false);
    // Nothing to label.
    assert.strictEqual(mayDrawDataLabels(chart({ display: true }, [])), false);
    assert.strictEqual(mayDrawDataLabels({ options: {}, data: {} }), false);
    assert.strictEqual(mayDrawDataLabels({}), false);
  });

  it('says no to a dataset config that does not turn labels back on', () => {
    // Configuring `datalabels` on a dataset is not the same as enabling it: with
    // the chart-level `display: false` a geo chart carries by default, each of
    // these still draws nothing, and the work a label would read is wasted.
    [{}, true, { display: false }, { color: 'red' }, { labels: { name: {} } }].forEach(
      (datalabels) => {
        assert.strictEqual(
          mayDrawDataLabels(chart({ display: false }, [{ datalabels }])),
          false,
          `dataset datalabels: ${JSON.stringify(datalabels)}`,
        );
      },
    );
    // `false` on the dataset switches labels off for it whatever the chart says.
    assert.strictEqual(mayDrawDataLabels(chart({ display: true }, [{ datalabels: false }])), false);
    assert.strictEqual(mayDrawDataLabels(chart(undefined, [{ datalabels: false }])), false);
    // Every named group off draws nothing, and a falsy group is skipped outright.
    assert.strictEqual(
      mayDrawDataLabels(chart({ display: true, labels: { name: { display: false } } })),
      false,
    );
    assert.strictEqual(mayDrawDataLabels(chart({ display: true, labels: { name: false } })), false);
  });

  it('says yes to anything a label could still come out of', () => {
    assert.strictEqual(mayDrawDataLabels(chart({ display: true })), true);
    // Scriptable, so its answer is not knowable here.
    assert.strictEqual(mayDrawDataLabels(chart({ display: () => false })), true);
    assert.strictEqual(mayDrawDataLabels(chart({ display: 'auto' })), true);
    // A named label group carries its own `display` over the merged one.
    assert.strictEqual(
      mayDrawDataLabels(chart({ display: false, labels: { name: { display: true } } })),
      true,
    );
    assert.strictEqual(
      mayDrawDataLabels(
        chart({ display: false }, [{ datalabels: { labels: { n: { display: 1 } } } }]),
      ),
      true,
    );
    // One group of two is enough.
    assert.strictEqual(
      mayDrawDataLabels(chart({ labels: { a: { display: false }, b: { display: true } } })),
      true,
    );
    // A dataset overrides the chart-level option, and one dataset is enough.
    assert.strictEqual(
      mayDrawDataLabels(chart({ display: false }, [{ datalabels: { display: true } }])),
      true,
    );
    assert.strictEqual(
      mayDrawDataLabels(chart({ display: true }, [{ datalabels: false }, {}])),
      true,
    );
    // Unconfigured: the plugin's own default is to display.
    assert.strictEqual(mayDrawDataLabels(chart(undefined)), true);
    assert.strictEqual(mayDrawDataLabels(chart({})), true);
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

  it('compiles names that are text elsewhere only where a function belongs', () => {
    // A legend entry that happens to read like an arrow function is text; the
    // same name under the tooltip's callbacks is code.
    const chart = {
      data: { datasets: [{ label: 'x => y', title: 'f(x) => y', data: [1] }] },
      options: {
        scales: { x: { title: { text: 'x => y' } } },
        plugins: {
          tooltip: {
            callbacks: { label: '(item) => item.formattedValue + " шт"', title: 'x => "T"' },
          },
          annotation: {
            annotations: {
              line1: { label: { content: '(ctx) => "peak"' }, value: 'v => 5' },
            },
          },
        },
      },
    };
    compileFunctionStrings(chart);

    assert.strictEqual(chart.data.datasets[0].label, 'x => y');
    assert.strictEqual(chart.data.datasets[0].title, 'f(x) => y');
    assert.strictEqual(chart.options.scales.x.title.text, 'x => y');
    assert.strictEqual(typeof chart.options.plugins.tooltip.callbacks.label, 'function');
    assert.strictEqual(typeof chart.options.plugins.tooltip.callbacks.title, 'function');
    const { line1 } = chart.options.plugins.annotation.annotations;
    assert.strictEqual(typeof line1.label.content, 'function');
    assert.strictEqual(typeof line1.value, 'function');
  });

  it('does not reject a legend entry whose "body" would not parse', () => {
    // Compiling this one would fail to parse and turn a fine chart into a 400.
    const chart = { data: { datasets: [{ label: 'y => 100%', data: [1] }] } };
    assert.doesNotThrow(() => compileFunctionStrings(chart));
    assert.strictEqual(chart.data.datasets[0].label, 'y => 100%');
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

  it('rejects a source that calls a function instead of being one', () => {
    // `new Function` evaluates this, so the call runs - config Javascript is
    // trusted and executed either way. What must not happen is the result being
    // dropped and the string left in the config, where Chart.js reads it as
    // truthy text and silently mislabels the chart.
    const chart = {
      options: { plugins: { datalabels: { formatter: 'function(v) { return v.y; }()' } } },
    };
    assert.throws(
      () => compileFunctionStrings(chart),
      (err) =>
        err instanceof ChartInputError &&
        err.statusCode === 400 &&
        err.message.includes('options.plugins.datalabels.formatter') &&
        err.message.includes('undefined'),
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

  it('shows datalabels by default for a funnel, which has no axes', async () => {
    const chart = {
      type: 'funnel',
      data: { labels: ['Показы', 'Клики'], datasets: [{ data: [1000, 600] }] },
    };
    await renderChartJs(400, 300, 'white', 1.0, undefined, 'png', chart);
    assert.strictEqual(chart.options.plugins.datalabels.display, true);
  });

  it('does not walk data rows or inline map geometry', () => {
    // Marks the arrays the walk must skip with a string it would compile if it
    // did descend into them - an inline world outline is ~4000 coordinate rings
    // and every row of it is caller data, not options.
    const outline = getMap('world').features.map((feature) => ({
      ...feature,
      properties: { ...feature.properties, callback: 'function() { return 1; }' },
    }));
    const chart = {
      type: 'choropleth',
      data: {
        labels: ['function() {}'],
        datasets: [{ outline, data: [{ feature: 'France', formatter: '() => 1', value: 1 }] }],
      },
    };
    compileFunctionStrings(chart);

    const [dataset] = chart.data.datasets;
    assert.strictEqual(typeof dataset.outline[0].properties.callback, 'string');
    assert.strictEqual(typeof dataset.data[0].formatter, 'string');
    assert.strictEqual(chart.data.labels[0], 'function() {}');
  });
});

describe('a dataset that says datalabels: false', () => {
  const bar = (datasets, options) => ({
    type: 'bar',
    data: { labels: ['a'], datasets },
    ...(options ? { options } : {}),
  });

  it('is reported as a 400 naming the spelling that works', async () => {
    await assert.rejects(
      renderChartJs(200, 150, '#fff', 1, '4', 'png', bar([{ data: [5], datalabels: false }])),
      (err) =>
        err instanceof ChartInputError &&
        err.statusCode === 400 &&
        err.message.includes('Dataset 0') &&
        err.message.includes('"datalabels": { "display": false }'),
      'expected a 400 pointing at the display option',
    );
  });

  it('names which dataset it was', async () => {
    await assert.rejects(
      renderChartJs(
        200,
        150,
        '#fff',
        1,
        '4',
        'png',
        bar([{ data: [5] }, { data: [3], datalabels: false }]),
      ),
      (err) => err.message.includes('Dataset 1'),
      'expected the message to name dataset 1',
    );
  });

  it('is rejected for every chart-level option that leaves the plugin live', async () => {
    // Including `0`, which chart.js does not read as "off" and which this server
    // replaces with its own defaults - either way the hook still runs.
    for (const datalabels of [{ display: false }, { display: true }, true, undefined, 0]) {
      // eslint-disable-next-line no-await-in-loop
      await assert.rejects(
        renderChartJs(
          200,
          150,
          '#fff',
          1,
          '4',
          'png',
          bar([{ data: [5], datalabels: false }], { plugins: { datalabels } }),
        ),
        (err) => err instanceof ChartInputError && err.statusCode === 400,
        `expected a 400 with chart-level datalabels: ${JSON.stringify(datalabels)}`,
      );
    }
  });

  it('needs no refusing when the plugin is switched off for the chart', async () => {
    // chart.js gives a switched-off plugin no hooks, so there is no null for it
    // to trip over and nothing here to refuse.
    for (const datalabels of [false, null]) {
      // eslint-disable-next-line no-await-in-loop
      const buf = await renderChartJs(
        200,
        150,
        '#fff',
        1,
        '4',
        'png',
        bar([{ data: [5], datalabels: false }], { plugins: { datalabels } }),
      );
      assert(buf.length > 0, `chart-level datalabels: ${JSON.stringify(datalabels)} failed`);
    }
  });

  it('is rejected for a dataset with no data of its own', async () => {
    // The plugin trips over a different null for this one, in the same hook.
    await assert.rejects(
      renderChartJs(200, 150, '#fff', 1, '4', 'png', bar([{ data: [], datalabels: false }])),
      (err) => err instanceof ChartInputError && err.statusCode === 400,
    );
  });

  it('leaves every value that does render alone', async () => {
    // `true` means "no overrides of my own"; a non-object merges over the
    // chart-level options as nothing. None of these is the crashing shape, so
    // none of them may start failing here.
    for (const datalabels of [true, { display: false }, { display: true }, null, 0, '', 'x']) {
      // eslint-disable-next-line no-await-in-loop
      const buf = await renderChartJs(
        200,
        150,
        '#fff',
        1,
        '4',
        'png',
        bar([{ data: [5], datalabels }], { plugins: { datalabels: { display: true } } }),
      );
      assert(buf.length > 0, `datalabels: ${JSON.stringify(datalabels)} failed to render`);
    }
  });
});

/**
 * Whether the plugin ended up with a label to draw. `$datalabels` is its own
 * per-chart state and a label carries a model only once its `display` resolved
 * true; state that is absent altogether means chart.js never gave the plugin a
 * hook to build one in, i.e. the plugin was switched off for the chart.
 */
async function labelsDrawn(chart) {
  const drawn = [];
  chart.plugins = [
    {
      id: 'test-labels-drawn',
      afterUpdate(instance) {
        const state = instance.$datalabels;
        drawn.push(((state && state._labels) || []).some((label) => label.model()));
      },
    },
  ];
  await renderChartJs(200, 150, '#fff', 1, '4', 'png', chart);
  return drawn.some(Boolean);
}

describe('switching datalabels off for a whole chart', () => {
  const chartOf = (type, plugins) => ({
    type,
    data: { labels: ['a', 'b'], datasets: [{ data: [5, 3] }] },
    options: { plugins: { legend: { display: false }, ...plugins } },
  });

  it('honours the values chart.js reads as "plugin off"', async () => {
    // The falsy check this used to make overwrote them with the defaults below,
    // and for a pie that default is `display: true` - so a caller who switched
    // labelling off got a labelled chart.
    for (const type of ['pie', 'doughnut', 'funnel', 'bar']) {
      for (const datalabels of [false, null]) {
        // eslint-disable-next-line no-await-in-loop
        const drawn = await labelsDrawn(chartOf(type, { datalabels }));
        assert.strictEqual(drawn, false, `${type} with datalabels: ${datalabels} drew labels`);
      }
    }
  });

  it('is not undone by a dataset asking for labels', async () => {
    const chart = chartOf('bar', { datalabels: false });
    chart.data.datasets[0].datalabels = { display: true };
    assert.strictEqual(await labelsDrawn(chart), false);
  });

  it('still applies this server’s defaults to everything else', async () => {
    // Unchanged behavior: labelled for the types with no axis to read a value
    // off, unlabelled elsewhere...
    assert.strictEqual(await labelsDrawn(chartOf('pie')), true);
    assert.strictEqual(await labelsDrawn(chartOf('bar')), false);
    // ...and a stray falsy that chart.js does not read as "off" is not a
    // configuration either, so it gets those same defaults rather than reaching
    // the plugin as its options.
    for (const junk of [0, '']) {
      // eslint-disable-next-line no-await-in-loop
      assert.strictEqual(
        await labelsDrawn(chartOf('bar', { datalabels: junk })),
        false,
        `bar with datalabels: ${JSON.stringify(junk)} drew labels`,
      );
    }
  });

  it('leaves a configured option exactly as the caller wrote it', async () => {
    for (const datalabels of [false, null, true, { display: true }]) {
      const chart = chartOf('bar', { datalabels });
      // eslint-disable-next-line no-await-in-loop
      await renderChartJs(200, 150, '#fff', 1, '4', 'png', chart);
      assert.deepStrictEqual(
        chart.options.plugins.datalabels,
        datalabels,
        `chart-level ${JSON.stringify(datalabels)} was rewritten`,
      );
    }
  });
});
