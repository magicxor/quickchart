const canvas = require('canvas');
const deepmerge = require('deepmerge');
const pattern = require('patternomaly');

const { Chart, BasicPlatform, topojson } = require('./chartjs');
const { ChartInputError } = require('./errors');
const { getMap, getMapGeography, matchFeature, resolveOutline } = require('./maps');
const {
  PROJECTION_OPTION_NAMES,
  autoProjectionSpec,
  bboxOutline,
  buildProjection,
  createFitPlugin,
  describeGeometry,
  isProjectionSpec,
  measureAspectRatio,
  toGeoJson,
  validateProjectionName,
} = require('./projection');
const {
  DEFAULT_LONG_SIDE,
  isGivenSize,
  ratioForType,
  resolveCanvasSize,
} = require('./canvas');
const { compileFunctionStrings } = require('./scriptable');
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

const FIT_SHAPE_ERROR =
  'Projection "fit" must be a [west, south, east, north] box, a { map, features } reference, or GeoJSON';
const FIT_NO_EXTENT_ERROR =
  'Projection "fit" geometry has no measurable extent - check its coordinates';

// `typeof` for error messages, with the two cases it gets unhelpfully wrong.
function describeType(value) {
  if (value === null) {
    return 'null';
  }
  return Array.isArray(value) ? 'array' : typeof value;
}

// Scale options are objects, and `typeof [] === 'object'` - so an array would
// otherwise pass for one and quietly collect the properties we fill in.
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// One entry of a `fit` feature list: a name/id to look up in the named map, or
// an inline GeoJSON object. Anything else (a number, null, a nested array)
// would travel on into d3 and come back as a blank chart or a TypeError rather
// than a 400.
function resolveFitFeature(mapName, entry) {
  if (typeof entry === 'string') {
    if (!mapName) {
      throw new ChartInputError(
        `Projection "fit" references feature "${entry}" by name but names no map. Add "map" to the fit, or pass inline GeoJSON.`,
      );
    }
    return matchFeature(mapName, entry);
  }
  if (entry && typeof entry === 'object' && typeof entry.type === 'string') {
    return entry;
  }
  throw new ChartInputError(
    mapName
      ? `Projection "fit" features must be feature names/ids of map "${mapName}" or inline GeoJSON objects`
      : 'Projection "fit" features must be inline GeoJSON objects, or names/ids alongside a "map"',
  );
}

// Resolves a projection scale's `fit` into the geometry to frame the map on: a
// `[west, south, east, north]` box, a built-in map (optionally narrowed to
// named features), or inline GeoJSON.
//
function resolveFitGeometry(spec) {
  if (Array.isArray(spec)) {
    return bboxOutline(spec);
  }
  if (!spec || typeof spec !== 'object') {
    throw new ChartInputError(FIT_SHAPE_ERROR);
  }
  if (spec.bbox !== undefined) {
    return bboxOutline(spec.bbox);
  }

  // No String() coercion: `{ map: null }` would become the map name "null" and
  // `{ map: ['rus'] }` would quietly succeed, both reported as if the caller had
  // asked for a map that does not exist.
  if (spec.map !== undefined && typeof spec.map !== 'string') {
    throw new ChartInputError(
      `Projection "fit" map must be a map name; got ${describeType(spec.map)}`,
    );
  }
  const mapName = spec.map !== undefined ? spec.map : null;
  let geometry;
  if (Array.isArray(spec.features)) {
    const features = spec.features.map((entry) => resolveFitFeature(mapName, entry));
    if (features.length === 0) {
      throw new ChartInputError('Projection "fit" selected no features');
    }
    geometry = { type: 'FeatureCollection', features };
  } else if (mapName) {
    // Check the cached extent rather than walking the geometry again: for
    // us-counties that walk alone costs ~70ms of every request.
    if (!getMapGeography(mapName).bbox) {
      throw new ChartInputError(FIT_NO_EXTENT_ERROR);
    }
    return { type: 'FeatureCollection', features: resolveOutline(mapName) };
  } else {
    geometry = toGeoJson(spec);
  }

  if (!geometry) {
    throw new ChartInputError(FIT_SHAPE_ERROR);
  }
  // Structurally plausible but unmeasurable geometry (empty rings, a Feature
  // with no coordinates) frames nothing and renders an empty canvas silently.
  if (!describeGeometry(geometry)) {
    throw new ChartInputError(FIT_NO_EXTENT_ERROR);
  }
  return geometry;
}

// Built-in maps are immutable and their automatic projection is cached with
// the map: measuring a detailed one costs upwards of 100ms, which is not worth
// repeating per request. An inline outline is request data and has to be
// measured every time.
function autoProjectionSpecFor(outline, mapName) {
  return mapName ? getMapGeography(mapName).projection : autoProjectionSpec(outline, null);
}

// Resolves the QuickChart extensions to the geo projection scale - the object
// form of `projection`, the `auto` keyword, and `fit` - into what
// chartjs-chart-geo expects. Returns the plugins the chart needs, and the
// framing the canvas can be sized from: the geometry that ends up on screen and
// the projection spec it is drawn through (null when the projection is left to
// the library, which is the one case this code cannot name).
function applyProjectionOptions(chart, outline, mapName) {
  const scale = chart.options.scales && chart.options.scales.projection;
  if (scale === undefined || scale === null) {
    // Absent by choice; chart.js applies chartjs-chart-geo's own scale defaults.
    return { plugins: [], framing: null };
  }
  if (!isPlainObject(scale)) {
    // chart.js only logs "Invalid scale configuration" for this and renders a
    // chart with no map at all.
    throw new ChartInputError(
      `options.scales.projection must be a scale options object; got ${describeType(scale)}`,
    );
  }

  // The scale is called `projection` and so is the option naming the projection
  // it uses, which invites writing the aiming keys one level too high. They are
  // not scale options, so chart.js would drop them without a word.
  const misplaced = PROJECTION_OPTION_NAMES.filter((name) => scale[name] !== undefined);
  if (misplaced.length > 0) {
    throw new ChartInputError(
      `Found ${misplaced.join(', ')} on the projection scale itself. Aiming options go inside its "projection" option: options.scales.projection.projection = { "type": ..., "${misplaced[0]}": ... }`,
    );
  }

  let fitGeometry = null;
  if (scale.fit !== undefined) {
    fitGeometry = resolveFitGeometry(scale.fit);
    // `fit` is a QuickChart extension, not a chartjs-chart-geo scale option.
    delete scale.fit;
  }

  // The spec the chart will actually draw through, kept for sizing: `scale
  // .projection` becomes an opaque d3 function below.
  let usedSpec = null;
  if (isProjectionSpec(scale.projection)) {
    usedSpec = scale.projection;
    scale.projection = buildProjection(scale.projection);
  } else if (scale.projection === 'auto') {
    // Aim at the region being framed when there is one: naming a fit region is
    // a more specific statement of intent than the outline it is cut from.
    // Without this, cropping a world map to the Russian Far East would frame
    // the Far East through a projection aimed at the whole globe.
    //
    // Measured from the geometry, deliberately without a map name even when the
    // fit names one: the AUTO_OVERRIDES entry for a map describes drawing that
    // map alone. `fit: { map: 'us-states' }` over a world map would resolve to
    // albersUsa, whose composite sub-projections smear Canada and Mexico into
    // the Alaska/Hawaii inset corners.
    usedSpec = fitGeometry
      ? autoProjectionSpec(fitGeometry, null)
      : autoProjectionSpecFor(outline, mapName);
    scale.projection = buildProjection(usedSpec);
  } else if (typeof scale.projection === 'string') {
    // chartjs-chart-geo silently falls back to albersUsa for unknown names,
    // which looks like a rendering bug rather than a typo.
    validateProjectionName(scale.projection);
    usedSpec = { type: scale.projection };
  } else if (scale.projection !== undefined && typeof scale.projection !== 'function') {
    // Same fallback, same confusion, for a value of the wrong type entirely.
    // `undefined` is left alone: that is the caller declining to choose, and
    // chartjs-chart-geo's own default applies.
    throw new ChartInputError(
      `Projection must be a name, "auto", or an object with a "type"; got ${describeType(scale.projection)}`,
    );
  }

  const geometry = fitGeometry || outline;
  return {
    plugins: fitGeometry ? [createFitPlugin(fitGeometry)] : [],
    framing: usedSpec && geometry ? { geometry, projection: usedSpec } : null,
  };
}

// Resolves built-in map references in geo datasets (see lib/maps.js): a
// string `outline`/`map` becomes the named map's GeoJSON features, and
// choropleth data rows may reference features by name/id. Inline GeoJSON
// values pass through untouched. Returns the plugins the chart needs and, for
// canvas sizing, the framing (see `applyProjectionOptions`).
function resolveGeoReferences(chart) {
  const datasets = chart.data && Array.isArray(chart.data.datasets) ? chart.data.datasets : [];
  const resolvedTypes = new Set();
  let isGeoChart = false;
  // The outline the automatic projection is aimed at, and the map name it came
  // from: the first geo dataset that has one wins.
  let autoOutline = null;
  let autoMapName = null;

  datasets.forEach((dataset) => {
    if (!dataset) {
      return;
    }
    const type = dataset.type || chart.type;
    if (type !== 'choropleth' && type !== 'bubbleMap') {
      return;
    }
    isGeoChart = true;
    // Neither is a dataset option; chart.js would ignore both silently.
    ['fit', 'projection'].forEach((key) => {
      if (dataset[key] !== undefined) {
        throw new ChartInputError(
          `"${key}" is a projection scale option, not a dataset option: set options.scales.projection.${key}`,
        );
      }
    });

    const mapName = typeof dataset.map === 'string' ? dataset.map : null;
    const outlineName = typeof dataset.outline === 'string' ? dataset.outline : null;
    if (mapName) {
      // `map` is a QuickChart extension, not a chartjs-chart-geo option.
      delete dataset.map;
    }
    // Which built-in map the outline came from, if any - an inline outline has
    // no name to cache a measurement under.
    let outlineSource = null;
    if (outlineName) {
      dataset.outline = resolveOutline(outlineName);
      outlineSource = outlineName;
    } else if (mapName && dataset.outline === undefined) {
      dataset.outline = resolveOutline(mapName);
      outlineSource = mapName;
    }
    if ((outlineName || mapName) && dataset.showOutline === undefined) {
      // Without this, regions that have no data row are invisible and the
      // chart doesn't read as a map.
      dataset.showOutline = true;
    }

    const matchMap = mapName || outlineName;
    if (autoOutline === null && dataset.outline) {
      autoOutline = dataset.outline;
      autoMapName = outlineSource;
    }

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

  if (!isGeoChart) {
    return { plugins: [], framing: null };
  }

  // A dataset used a built-in map: fill in the minimal geo scales so a bare
  // config renders. User-provided scales are left untouched.
  if (resolvedTypes.size > 0) {
    chart.options.scales = chart.options.scales || {};
    const { scales } = chart.options;
    // `=== undefined` rather than `||`: an explicitly provided falsy value
    // (e.g. null) is a user decision and must not be overridden.
    if (scales.projection === undefined) {
      // Aimed at the map below, rather than a fixed projection: a bare
      // equalEarth frames anything that crosses the antimeridian - Russia, the
      // US with its Aleutians, Fiji - at a fraction of the canvas.
      scales.projection = { axis: 'x', projection: 'auto' };
    } else if (isPlainObject(scales.projection) && scales.projection.projection === undefined) {
      // Configuring the scale without naming a projection leaves
      // chartjs-chart-geo's albersUsa default in place, which is wrong for
      // every map but the US ones.
      scales.projection.projection = 'auto';
    }
    if (resolvedTypes.has('choropleth') && scales.color === undefined) {
      scales.color = { axis: 'x' };
    }
    if (resolvedTypes.has('bubbleMap') && scales.size === undefined) {
      scales.size = { axis: 'x' };
    }
    // The dataset legend is meaningless for a map (the color/size scale
    // renders its own legend); hide it unless the user configured one.
    chart.options.plugins = chart.options.plugins || {};
    if (chart.options.plugins.legend === undefined) {
      chart.options.plugins.legend = { display: false };
    }
  }

  return applyProjectionOptions(chart, autoOutline, autoMapName);
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

// Evaluates the caller's config (if it is Javascript) and applies every
// transform the renderer makes before the chart is built. Run once per set of
// canvas dimensions: the gradient helpers close over them.
function prepareChart(untrustedChart, width, height) {
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
  // Callbacks quoted as strings - the only way a strict-JSON config can carry
  // one - would otherwise be ignored without a word.
  compileFunctionStrings(chart);

  chart.options = chart.options || {};

  applyTypeTransforms(chart);
  const { plugins, framing } = resolveGeoReferences(chart);
  applyQuickchartDefaults(chart);
  // The `window` shim in ./chartjs would make chart.js auto-detect a DOM
  // platform; explicitly select the headless one. Set here so that the layout
  // pass in `measureChrome` uses it too.
  chart.platform = BasicPlatform;
  return { chart, geoPlugins: plugins, framing };
}

// What the canvas spends on title, legend, axes and padding rather than on the
// plot itself, measured by laying the chart out once on a throwaway canvas.
// Laying out costs a few milliseconds; drawing is what takes hundreds.
function measureChrome(chart, width, height) {
  let instance;
  try {
    instance = new Chart(canvas.createCanvas(width, height).getContext('2d'), chart);
  } catch {
    // Config errors surface properly when the real chart is built.
    return null;
  }
  try {
    const { left, right, top, bottom } = instance.chartArea;
    const spare = { w: width - (right - left), h: height - (bottom - top) };
    return spare.w >= 0 && spare.h >= 0 ? spare : null;
  } finally {
    instance.destroy();
  }
}

// Sizes the canvas for a chart the caller did not fully dimension. Geo charts
// are measured through their projection, so the plot area ends up shaped like
// the map; every other type gets the proportions it is usually read at.
function sizeCanvas(chart, framing, width, height) {
  const ratio =
    (framing && measureAspectRatio(framing.geometry, framing.projection)) ||
    ratioForType(chart.type);
  const bounds = { maxWidth: MAX_WIDTH, maxHeight: MAX_HEIGHT };
  let size = resolveCanvasSize({ width, height, ratio, ...bounds });
  if (!framing) {
    // A type ratio describes the canvas; only a measured map describes the plot
    // area, and only then is the chrome worth accounting for.
    return size;
  }
  // Two passes at most: the first learns the chrome, the second confirms it did
  // not change when the canvas did (a legend can rewrap at a new width).
  let chrome = null;
  for (let pass = 0; pass < 2; pass += 1) {
    const measured = measureChrome(chart, size.width, size.height);
    if (!measured || (chrome && measured.w === chrome.w && measured.h === chrome.h)) {
      break;
    }
    chrome = measured;
    size = resolveCanvasSize({ width, height, ratio, chrome, ...bounds });
  }
  return size;
}

function validateRequestedSize(value, max, name) {
  if (!isGivenSize(value)) {
    return;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new ChartInputError(`Requested ${name} must be a positive integer`);
  }
  if (value > max) {
    throw new ChartInputError(`Requested ${name} exceeds maximum of ${max}`);
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
  validateRequestedSize(width, MAX_WIDTH, 'width');
  validateRequestedSize(height, MAX_HEIGHT, 'height');
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

  // Provisional dimensions for the first pass: whatever the caller gave, and a
  // square of the default side for whatever they left open.
  const provisional = {
    width: isGivenSize(width) ? width : DEFAULT_LONG_SIDE,
    height: isGivenSize(height) ? height : DEFAULT_LONG_SIDE,
  };
  let prepared = prepareChart(untrustedChart, provisional.width, provisional.height);
  let { chart } = prepared;
  chart.options.responsive = false;
  chart.options.animation = false;

  const size = sizeCanvas(chart, prepared.framing, width, height);
  if (
    typeof untrustedChart === 'string' &&
    (size.width !== provisional.width || size.height !== provisional.height)
  ) {
    // Gradients built by the helpers default to the canvas extent, so a config
    // that uses them has to be evaluated again now that the extent is known.
    prepared = prepareChart(untrustedChart, size.width, size.height);
    chart = prepared.chart;
    chart.options.responsive = false;
    chart.options.animation = false;
  }
  const geoPlugins = prepared.geoPlugins;

  // Charts are rendered exactly once, server-side.
  // Retina resolution by default: images are 2x the requested size in
  // absolute terms. `dpr` was validated at the top of this function.
  chart.options.devicePixelRatio = dpr;

  logger.debug('Chart:', JSON.stringify(chart));

  chart.plugins = Array.isArray(chart.plugins) ? chart.plugins : [];
  chart.plugins.push(...geoPlugins);

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
      ? canvas.createCanvas(size.width, size.height, 'svg')
      : canvas.createCanvas(size.width, size.height);

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
