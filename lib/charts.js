const canvas = require('canvas');
const deepmerge = require('deepmerge');
const pattern = require('patternomaly');

const { Chart, BasicPlatform, topojson } = require('./chartjs');
const { ChartInputError } = require('./errors');
const { getMap, matchFeature, resolveOutline } = require('./maps');
const { fixNodeVmObject } = require('./util');
const { logger } = require('../logging');
const { uniqueSvg } = require('./svg');

// Make gradients available to user-supplied JS configs that reference the
// CanvasGradient constructor directly.
global.CanvasGradient = canvas.CanvasGradient;

const MAX_HEIGHT = process.env.CHART_MAX_HEIGHT || 3000;
const MAX_WIDTH = process.env.CHART_MAX_WIDTH || 3000;
const MAX_DEVICE_PIXEL_RATIO = 4;

// Chart types whose controllers schedule extra layout passes through the
// requestAnimationFrame shim (see ./chartjs) and need the event loop to turn
// before the canvas is captured.
const ASYNC_LAYOUT_CHART_TYPES = new Set(['graph', 'forceDirectedGraph', 'dendrogram', 'tree']);

function needsAsyncLayout(chart) {
  if (ASYNC_LAYOUT_CHART_TYPES.has(chart.type)) {
    return true;
  }
  const datasets = chart.data && Array.isArray(chart.data.datasets) ? chart.data.datasets : [];
  return datasets.some((dataset) => dataset && ASYNC_LAYOUT_CHART_TYPES.has(dataset.type));
}

function getGradientFunctions(width, height) {
  const getGradientFill = (colorOptions, linearGradient = [0, 0, width, 0]) => {
    return function colorFunction() {
      const ctx = canvas.createCanvas(20, 20).getContext('2d');
      const gradientFill = ctx.createLinearGradient(...linearGradient);
      colorOptions.forEach((options) => {
        gradientFill.addColorStop(options.offset, options.color);
      });
      return gradientFill;
    };
  };

  const getGradientFillHelper = (direction, colors, dimensions = {}) => {
    const colorOptions = colors.map((color, idx) => {
      return {
        color,
        offset: idx / (colors.length - 1 || 1),
      };
    });

    let linearGradient = [0, 0, dimensions.width || width, 0];
    if (direction === 'vertical') {
      linearGradient = [0, 0, 0, dimensions.height || height];
    } else if (direction === 'both') {
      linearGradient = [0, 0, dimensions.width || width, dimensions.height || height];
    }
    return getGradientFill(colorOptions, linearGradient);
  };

  return {
    getGradientFill,
    getGradientFillHelper,
  };
}

function patternDraw(shapeType, backgroundColor, patternColor, requestedSize) {
  return function doPatternDraw() {
    const size = Math.min(200, requestedSize) || 20;
    // patternomaly requires a document global...
    global.document = {
      createElement: () => {
        return canvas.createCanvas(size, size);
      },
    };
    return pattern.draw(shapeType, backgroundColor, patternColor, size);
  };
}

// Rewrites QuickChart's custom chart types to real Chart.js types.
function applyTypeTransforms(chart) {
  if (chart.type === 'donut') {
    // Fix spelling...
    chart.type = 'doughnut';
  }

  if (chart.type === 'horizontalBoxplot') {
    chart.type = 'boxplot';
    chart.options.indexAxis = chart.options.indexAxis || 'y';
  }
  if (chart.type === 'horizontalViolin') {
    chart.type = 'violin';
    chart.options.indexAxis = chart.options.indexAxis || 'y';
  }

  if (chart.type === 'sparkline') {
    if (
      !chart.data ||
      !Array.isArray(chart.data.datasets) ||
      chart.data.datasets.length < 1 ||
      !chart.data.datasets[0] ||
      !Array.isArray(chart.data.datasets[0].data)
    ) {
      throw new ChartInputError('"sparkline" requires 1 dataset with a data array');
    }
    chart.type = 'line';
    const dataseries = chart.data.datasets[0].data;
    if (!chart.data.labels) {
      chart.data.labels = Array(dataseries.length);
    }
    chart.options.plugins = chart.options.plugins || {};
    chart.options.plugins.legend = chart.options.plugins.legend || { display: false };
    if (!chart.options.elements) {
      chart.options.elements = {};
    }
    chart.options.elements.line = chart.options.elements.line || {
      borderColor: '#000',
      borderWidth: 1,
    };
    chart.options.elements.point = chart.options.elements.point || {
      radius: 0,
    };
    if (!chart.options.scales) {
      chart.options.scales = {};
    }

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < dataseries.length; i += 1) {
      const dp = dataseries[i];
      min = Math.min(min, dp);
      max = Math.max(max, dp);
    }

    // Pad both bounds by 5% of the data range so that pixels aren't shaved
    // off. Padding must be range-based: scaling the bounds themselves would
    // move them the wrong way for negative values and clip data points.
    const range = max - min;
    const padding = range === 0 ? Math.abs(min) * 0.05 || 1 : range * 0.05;

    chart.options.scales.x = chart.options.scales.x || { display: false };
    chart.options.scales.y = chart.options.scales.y || {
      display: false,
      min: min - padding,
      max: max + padding,
    };
  }

  if (chart.type === 'progressBar') {
    chart.type = 'bar';

    if (
      !chart.data ||
      !Array.isArray(chart.data.datasets) ||
      chart.data.datasets.length < 1 ||
      chart.data.datasets.length > 2
    ) {
      throw new ChartInputError('progressBar chart requires 1 or 2 datasets');
    }
    if (chart.data.datasets.some((dataset) => !dataset || !Array.isArray(dataset.data))) {
      throw new ChartInputError('progressBar datasets must contain data arrays');
    }

    let usePercentage = false;
    const dataLen = chart.data.datasets[0].data.length;
    if (chart.data.datasets.length === 1) {
      // Implicit denominator, always out of 100.
      usePercentage = true;
      chart.data.datasets.push({ data: Array(dataLen).fill(100) });
    }
    if (chart.data.datasets[0].data.length !== chart.data.datasets[1].data.length) {
      throw new ChartInputError('progressBar datasets must have the same size of data');
    }

    // Respect user-provided labels; `chart.labels` is kept as a legacy
    // fallback location that old clients used.
    chart.data.labels = chart.data.labels || chart.labels || Array.from(Array(dataLen).keys());
    chart.data.datasets[1].backgroundColor = chart.data.datasets[1].backgroundColor || '#fff';
    // Set default border color to first Tableau color.
    chart.data.datasets[1].borderColor = chart.data.datasets[1].borderColor || '#4e78a7';
    chart.data.datasets[1].borderWidth = chart.data.datasets[1].borderWidth || 1;

    chart.options = deepmerge(
      {
        indexAxis: 'y',
        scales: {
          x: {
            display: false,
            beginAtZero: true,
          },
          y: {
            display: false,
            stacked: true,
          },
        },
        plugins: {
          legend: { display: false },
          datalabels: {
            color: '#fff',
            formatter: (val) => {
              if (usePercentage) {
                return `${val}%`;
              }
              return val;
            },
            display: (ctx) => ctx.datasetIndex === 0,
          },
        },
      },
      chart.options,
    );
  }
}

// Resolves built-in map references in geo datasets (see lib/maps.js): a
// string `outline`/`map` becomes the named map's GeoJSON features, and
// choropleth data rows may reference features by name/id. Inline GeoJSON
// values pass through untouched.
function resolveGeoReferences(chart) {
  const datasets = chart.data && Array.isArray(chart.data.datasets) ? chart.data.datasets : [];
  const resolvedTypes = new Set();

  datasets.forEach((dataset) => {
    if (!dataset) {
      return;
    }
    const type = dataset.type || chart.type;
    if (type !== 'choropleth' && type !== 'bubbleMap') {
      return;
    }

    const mapName = typeof dataset.map === 'string' ? dataset.map : null;
    const outlineName = typeof dataset.outline === 'string' ? dataset.outline : null;
    if (mapName) {
      // `map` is a QuickChart extension, not a chartjs-chart-geo option.
      delete dataset.map;
    }
    if (outlineName) {
      dataset.outline = resolveOutline(outlineName);
    } else if (mapName && dataset.outline === undefined) {
      dataset.outline = resolveOutline(mapName);
    }
    if ((outlineName || mapName) && dataset.showOutline === undefined) {
      // Without this, regions that have no data row are invisible and the
      // chart doesn't read as a map.
      dataset.showOutline = true;
    }

    const matchMap = mapName || outlineName;
    if (type === 'choropleth' && Array.isArray(dataset.data)) {
      dataset.data.forEach((row) => {
        if (row && typeof row.feature === 'string') {
          if (!matchMap) {
            throw new ChartInputError(
              `Data row references feature "${row.feature}" by name, but the dataset does not name a built-in map. Set the dataset's "map" or "outline" to a map name (see GET /maps).`,
            );
          }
          row.feature = matchFeature(matchMap, row.feature);
        }
      });
    }

    if (matchMap) {
      resolvedTypes.add(type);
    }
  });

  // A dataset used a built-in map: fill in the minimal geo scales so a bare
  // config renders. User-provided scales are left untouched.
  if (resolvedTypes.size > 0) {
    chart.options.scales = chart.options.scales || {};
    const { scales } = chart.options;
    scales.projection = scales.projection || { axis: 'x', projection: 'equalEarth' };
    if (resolvedTypes.has('choropleth')) {
      scales.color = scales.color || { axis: 'x' };
    }
    if (resolvedTypes.has('bubbleMap')) {
      scales.size = scales.size || { axis: 'x' };
    }
    // The dataset legend is meaningless for a map (the color/size scale
    // renders its own legend); hide it unless the user configured one.
    chart.options.plugins = chart.options.plugins || {};
    if (chart.options.plugins.legend === undefined) {
      chart.options.plugins.legend = { display: false };
    }
  }
}

function applyQuickchartDefaults(chart) {
  if (
    chart.type === 'bar' ||
    chart.type === 'line' ||
    chart.type === 'scatter' ||
    chart.type === 'bubble'
  ) {
    if (!chart.options.scales) {
      chart.options.scales = {
        y: {
          beginAtZero: true,
        },
      };
    }
  }

  chart.options.plugins = chart.options.plugins || {};
  if (!chart.options.plugins.datalabels) {
    // datalabels is registered globally - keep the historical QuickChart
    // defaults: shown for pie/doughnut, hidden for everything else.
    chart.options.plugins.datalabels = {
      display: chart.type === 'pie' || chart.type === 'doughnut',
    };
  }
}

async function renderChartJs(
  width,
  height,
  backgroundColor,
  devicePixelRatio,
  version,
  format,
  untrustedChart,
) {
  if (!Number.isInteger(width) || width < 1) {
    throw new ChartInputError('Requested width must be a positive integer');
  }
  if (!Number.isInteger(height) || height < 1) {
    throw new ChartInputError('Requested height must be a positive integer');
  }
  if (width > MAX_WIDTH) {
    throw new ChartInputError(`Requested width exceeds maximum of ${MAX_WIDTH}`);
  }
  if (height > MAX_HEIGHT) {
    throw new ChartInputError(`Requested height exceeds maximum of ${MAX_HEIGHT}`);
  }
  // The backing canvas is width*dpr x height*dpr; an unbounded ratio would
  // allow enormous allocations regardless of the width/height limits.
  let dpr = 2.0;
  if (devicePixelRatio !== undefined && devicePixelRatio !== null && devicePixelRatio !== '') {
    dpr = Number(devicePixelRatio);
    if (!Number.isFinite(dpr) || dpr <= 0 || dpr > MAX_DEVICE_PIXEL_RATIO) {
      throw new ChartInputError(
        `devicePixelRatio must be a number greater than 0 and at most ${MAX_DEVICE_PIXEL_RATIO}`,
      );
    }
  }
  if (version && !String(version).startsWith('4')) {
    logger.warn(
      `Chart.js version ${version} was requested but is no longer supported - rendering with latest 4.x`,
    );
  }

  let chart;
  if (typeof untrustedChart === 'string') {
    // The chart could contain Javascript - evaluate it.
    try {
      const { getGradientFill, getGradientFillHelper } = getGradientFunctions(width, height);
      const chartFunction = new Function(
        'getGradientFill',
        'getGradientFillHelper',
        'pattern',
        'Chart',
        'topojson',
        'getMap',
        `return ${untrustedChart}`,
      );
      chart = chartFunction(
        getGradientFill,
        getGradientFillHelper,
        { draw: patternDraw },
        Chart,
        topojson,
        getMap,
      );
    } catch (err) {
      logger.error('Input Error', err, untrustedChart);
      throw new ChartInputError(`Invalid input\n${err}`);
    }
  } else {
    // The chart is just a simple JSON object.
    chart = untrustedChart;
  }

  fixNodeVmObject(chart);

  chart.options = chart.options || {};

  applyTypeTransforms(chart);
  resolveGeoReferences(chart);
  applyQuickchartDefaults(chart);

  // Charts are rendered exactly once, server-side.
  chart.options.responsive = false;
  chart.options.animation = false;
  // Retina resolution by default: images are 2x the requested size in
  // absolute terms. `dpr` was validated at the top of this function.
  chart.options.devicePixelRatio = dpr;

  logger.debug('Chart:', JSON.stringify(chart));

  chart.plugins = Array.isArray(chart.plugins) ? chart.plugins : [];

  // Background color plugin
  chart.plugins.push({
    id: 'background',
    beforeDraw: (chartInstance) => {
      if (backgroundColor) {
        const { ctx } = chartInstance;
        ctx.save();
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, chartInstance.width, chartInstance.height);
        ctx.restore();
      }
    },
  });

  const renderCanvas =
    format === 'svg'
      ? canvas.createCanvas(width, height, 'svg')
      : canvas.createCanvas(width, height);

  // The `window` shim in ./chartjs would make chart.js auto-detect a DOM
  // platform; explicitly select the headless one.
  chart.platform = BasicPlatform;

  let chartInstance;
  try {
    chartInstance = new Chart(renderCanvas.getContext('2d'), chart);
  } catch (err) {
    // Chart construction failures are config-induced (unknown chart type, bad
    // scale setup, malformed data, ...).
    throw new ChartInputError(err.message || String(err));
  }
  try {
    if (format === 'svg') {
      return Buffer.from(uniqueSvg(renderCanvas.toBuffer().toString('utf8')));
    }
    if (needsAsyncLayout(chart)) {
      // Graph/tree controllers schedule extra layout passes through the
      // requestAnimationFrame shim. Let those settle before capturing the
      // canvas; other chart types draw fully synchronously.
      for (let i = 0; i < 4; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
          setImmediate(resolve);
        });
      }
    }
    return renderCanvas.toBuffer('image/png');
  } finally {
    chartInstance.destroy();
  }
}

module.exports = {
  renderChartJs,
};
