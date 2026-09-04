const canvas = require('canvas');
const deepmerge = require('deepmerge');

const { Chart, BasicPlatform } = require('./chartjs');
const { ChartInputError } = require('./errors');
const {
  featureAlias,
  getFeatureExtents,
  getMapGeography,
  matchFeature,
  normalizeName: normalizeMapName,
  resolveOutline,
} = require('./maps');
const {
  PROJECTION_OPTION_NAMES,
  autoProjectionSpec,
  bboxOutline,
  boxesIntersect,
  buildProjection,
  createFitPlugin,
  createLabelAnchorPlugin,
  describeGeometry,
  isProjectionSpec,
  mainlandGeometry,
  measureAspectRatio,
  toGeoJson,
  validateProjectionName,
} = require('./projection');
const { isGivenSize, parsePixelSize, ratioForType, resolveCanvasSize } = require('./canvas');
const { configuresDataLabels, mayDrawDataLabels, validateDataLabels } = require('./datalabels');
const { annotationsConfigured, buildChartWithLabelRoom, createRoomPlugin } = require('./labelroom');
const { rejectFunctionStrings } = require('./scriptable');
const { logger } = require('../logging');
const { uniqueSvg } = require('./svg');

// Parsed rather than taken as given: a bound that stays a string compares as
// NaN, which silently removes the limit, and reaches the derived-size
// arithmetic as NaN, which reaches node-canvas as a canvas size.
const MAX_HEIGHT = parsePixelSize(process.env.CHART_MAX_HEIGHT, 3000);
const MAX_WIDTH = parsePixelSize(process.env.CHART_MAX_WIDTH, 3000);
const MAX_DEVICE_PIXEL_RATIO = 4;

// Chart types whose controllers schedule extra layout passes through the
// requestAnimationFrame shim (see ./chartjs) and need the event loop to turn
// before the canvas is captured.
const ASYNC_LAYOUT_CHART_TYPES = new Set(['graph', 'forceDirectedGraph', 'dendrogram', 'tree']);

// Chart types that draw no axes: a pie/doughnut slice and a funnel stage can
// only be read off its own label, so datalabels defaults to shown for them.
const AXISLESS_CHART_TYPES = new Set(['pie', 'doughnut', 'funnel']);

function needsAsyncLayout(chart) {
  if (ASYNC_LAYOUT_CHART_TYPES.has(chart.type)) {
    return true;
  }
  const datasets = chart.data && Array.isArray(chart.data.datasets) ? chart.data.datasets : [];
  return datasets.some((dataset) => dataset && ASYNC_LAYOUT_CHART_TYPES.has(dataset.type));
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

// The `mainland` switch of a `fit`: opt-in, because dropping part of the
// geometry a caller named is not something to do behind their back.
function resolveMainlandFlag(spec) {
  if (spec.mainland === undefined) {
    return false;
  }
  if (typeof spec.mainland !== 'boolean') {
    throw new ChartInputError(
      `Projection "fit" mainland must be true or false; got ${describeType(spec.mainland)}`,
    );
  }
  return spec.mainland;
}

// Resolves a projection scale's `fit` into the geometry to frame the map on: a
// `[west, south, east, north]` box, a built-in map (optionally narrowed to
// named features), or inline GeoJSON. With `mainland: true` the geometry is
// reduced to its main body first (see `mainlandGeometry`).
//
function resolveFitGeometry(spec) {
  if (Array.isArray(spec)) {
    return bboxOutline(spec);
  }
  if (!spec || typeof spec !== 'object') {
    throw new ChartInputError(FIT_SHAPE_ERROR);
  }
  const mainland = resolveMainlandFlag(spec);
  if (spec.bbox !== undefined) {
    // A box is one part; there is nothing to narrow it to.
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
    const wholeMap = { type: 'FeatureCollection', features: resolveOutline(mapName) };
    return mainland ? mainlandGeometry(wholeMap) : wholeMap;
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
  return mainland ? mainlandGeometry(geometry) : geometry;
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
    fitGeometry,
  };
}

// How many uncovered features are named in the coverage report before it falls
// back to counting them: enough to act on, small enough for a response header.
const MISSING_FEATURES_REPORTED = 20;

// The features of a map that the view actually shows. Without a fit that is all
// of them; with one, those that reach into the framed box.
function framedFeatures(mapName, frameBox) {
  if (!frameBox) {
    return resolveOutline(mapName);
  }
  // The extents are cached with the map, so measuring every feature of a
  // detailed one happens once per process rather than once per request.
  return getFeatureExtents(mapName)
    .filter(({ bbox }) => bbox && boxesIntersect(frameBox, bbox))
    .map(({ feature }) => feature);
}

/**
 * Reports the features a choropleth left without data: they render as the grey
 * backdrop, which reads as an unfinished map rather than as missing data, and
 * nothing else in the response says so. Returns null when every framed feature
 * of every map used has a row.
 *
 * `matchedByMap` holds the resolved feature objects per map name; they are the
 * instances cached with the map (see `matchFeature`), so identity is enough.
 */
function describeGeoCoverage(matchedByMap, frameBox) {
  const maps = [];
  matchedByMap.forEach((matched, mapName) => {
    const framed = framedFeatures(mapName, frameBox);
    const missing = framed.filter((feature) => !matched.has(feature));
    if (missing.length === 0) {
      return;
    }
    const named = missing.map(featureAlias).filter((alias) => alias !== null);
    const entry = {
      map: mapName,
      framed: framed.length,
      covered: framed.length - missing.length,
      missing: named.slice(0, MISSING_FEATURES_REPORTED),
    };
    if (missing.length > entry.missing.length) {
      entry.more = missing.length - entry.missing.length;
    }
    maps.push(entry);
  });
  return maps.length > 0 ? { maps } : null;
}

// Resolves built-in map references in geo datasets (see lib/maps.js): a
// string `outline`/`map` becomes the named map's GeoJSON features, and
// choropleth data rows may reference features by name/id. Inline GeoJSON
// values pass through untouched. Returns whether this is a geo chart at all,
// the plugins it needs, the framing for canvas sizing (see
// `applyProjectionOptions`), and which map features were left without data
// (see `describeGeoCoverage`).
function resolveGeoReferences(chart) {
  const datasets = chart.data && Array.isArray(chart.data.datasets) ? chart.data.datasets : [];
  const resolvedTypes = new Set();
  // Map name -> the features its choropleth datasets have data rows for. Several
  // datasets can share a map (one per category is how a categorical map is
  // built), so coverage is only meaningful pooled across them.
  const matchedByMap = new Map();
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
      // Keyed by the name the registry resolves to, not by the spelling the
      // dataset used: map names are case-insensitive, so datasets naming "BLR"
      // and "blr" draw one map and their rows have to pool into one report.
      const coverageKey = matchMap ? normalizeMapName(matchMap) : null;
      const matched = coverageKey ? matchedByMap.get(coverageKey) || new Set() : null;
      dataset.data.forEach((row) => {
        if (row && typeof row.feature === 'string') {
          if (!matchMap) {
            throw new ChartInputError(
              `Data row references feature "${row.feature}" by name, but the dataset does not name a built-in map. Set the dataset's "map" or "outline" to a map name (see GET /maps).`,
            );
          }
          row.feature = matchFeature(matchMap, row.feature);
        }
        if (matched && row && row.feature) {
          matched.add(row.feature);
        }
      });
      if (matched) {
        matchedByMap.set(coverageKey, matched);
      }
    }

    if (matchMap) {
      resolvedTypes.add(type);
    }
  });

  if (!isGeoChart) {
    return { plugins: [], framing: null, geoCoverage: null, isGeoChart };
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

  const { plugins, framing, fitGeometry } = applyProjectionOptions(chart, autoOutline, autoMapName);
  // Only a fit narrows what is on screen; without one the whole map is framed
  // and every feature of it counts.
  const frameBox = fitGeometry ? (describeGeometry(fitGeometry) || {}).bbox : null;
  return {
    plugins,
    framing,
    geoCoverage: describeGeoCoverage(matchedByMap, frameBox),
    isGeoChart,
  };
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
  if (!configuresDataLabels(chart.options.plugins.datalabels)) {
    // datalabels is registered globally - keep the historical QuickChart
    // defaults: shown for the types that carry no axis to read a value off,
    // hidden for everything else.
    //
    // Anything the caller did configure is left alone, `false`/`null` included:
    // those are how chart.js is told a plugin is off, and a falsy check here used
    // to overwrite them with these defaults - which for a pie or a funnel is
    // `display: true`, i.e. it labelled a chart whose caller had switched
    // labelling off. Same principle as the scales above.
    chart.options.plugins.datalabels = {
      display: AXISLESS_CHART_TYPES.has(chart.type),
    };
  }
}

function describeConfigValue(value) {
  if (value === null) {
    return 'null';
  }
  return Array.isArray(value) ? 'an array' : `a ${typeof value}`;
}

// The caller's config as an object. It arrives as one from a JSON body, or as
// text from a query string or a JSON-encoded body field; text is parsed as JSON
// and nothing in it is ever executed.
function parseChartConfig(untrustedChart) {
  let chart = untrustedChart;
  if (typeof chart === 'string') {
    try {
      chart = JSON.parse(chart);
    } catch (err) {
      throw new ChartInputError(
        `Invalid input\nThe chart config is not valid JSON: ${err.message}`,
      );
    }
  }
  if (chart === null || typeof chart !== 'object' || Array.isArray(chart)) {
    throw new ChartInputError(
      `Invalid input\nThe chart config must be a JSON object, got ${describeConfigValue(chart)}`,
    );
  }
  return chart;
}

// Parses the caller's config and applies every transform the renderer makes
// before the chart is built.
function prepareChart(untrustedChart) {
  const chart = parseChartConfig(untrustedChart);
  // A function source quoted into an option would be read by Chart.js as text
  // and misrender without a word - see ./scriptable.
  rejectFunctionStrings(chart);

  chart.options = chart.options || {};

  // What the caller asked for, before the QuickChart types are rewritten to
  // real chart.js ones: a sparkline is a strip and a progressBar is a bar and
  // its label, which is not something `line` or `bar` says about its canvas.
  const requestedType = chart.type;
  applyTypeTransforms(chart);
  // Before the geo work below, which is the expensive part: this one config
  // value cannot be rendered at all (see `validateDataLabels`).
  validateDataLabels(chart);
  const { plugins, framing, geoCoverage, isGeoChart } = resolveGeoReferences(chart);
  applyQuickchartDefaults(chart);
  // After the defaults, since those are what settle whether a geo chart labels
  // its regions: a label anchor is the only thing this plugin computes, and
  // computing one per region costs real time on a detailed map.
  if (isGeoChart && mayDrawDataLabels(chart)) {
    plugins.push(createLabelAnchorPlugin());
  }
  // The `window` shim in ./chartjs would make chart.js auto-detect a DOM
  // platform; explicitly select the headless one. Set here so that the layout
  // pass in `measureChrome` uses it too.
  chart.platform = BasicPlatform;
  return { chart, geoPlugins: plugins, framing, geoCoverage, requestedType };
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
function sizeCanvas(prepared, width, height) {
  if (isGivenSize(width) && isGivenSize(height)) {
    // Nothing to derive: measuring the map and laying the chart out would be
    // work thrown away, and projecting a detailed map is not cheap.
    return { width: Number(width), height: Number(height) };
  }
  const { chart, framing, requestedType } = prepared;
  const ratio =
    (framing && measureAspectRatio(framing.geometry, framing.projection)) ||
    ratioForType(requestedType);
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

/**
 * Renders a chart config to a png/svg/pdf buffer.
 *
 * `diagnostics`, when given, is filled with what the renderer learned about the
 * chart on the way - currently `geoCoverage` (see `describeGeoCoverage`). It is
 * an out-parameter rather than part of the return value because callers want
 * the buffer and nothing else; the HTTP layer reads it for response headers.
 */
async function renderChartJs(
  width,
  height,
  backgroundColor,
  devicePixelRatio,
  version,
  format,
  untrustedChart,
  diagnostics,
) {
  validateRequestedSize(width, MAX_WIDTH, 'width');
  validateRequestedSize(height, MAX_HEIGHT, 'height');
  // The backing canvas is the resolved size times dpr - and the resolved size
  // is itself bounded by MAX_WIDTH/MAX_HEIGHT, given or derived - so an
  // unbounded ratio would still allow enormous allocations.
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

  const prepared = prepareChart(untrustedChart);
  const { chart } = prepared;
  chart.options.responsive = false;
  chart.options.animation = false;

  const size = sizeCanvas(prepared, width, height);
  if (diagnostics && prepared.geoCoverage) {
    diagnostics.geoCoverage = prepared.geoCoverage;
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

  // Labels and annotations may ink outside the plot area, where the layout
  // reserved nothing for them and they are clipped - by the plot edge or the
  // canvas - or land on the title. Such charts are built through measured
  // passes that hold room open for that ink (see ./labelroom). Charts whose
  // layout settles asynchronously cannot be measured this way: what a pass
  // would read is not what will be drawn.
  const reserve = { top: 0, right: 0, bottom: 0, left: 0 };
  const wantsLabelRoom =
    !needsAsyncLayout(chart) && (annotationsConfigured(chart) || mayDrawDataLabels(chart));
  if (wantsLabelRoom) {
    chart.plugins.push(createRoomPlugin(reserve));
  }

  // A fresh canvas per build: an SVG canvas records every drawing command
  // ever made on it, and destroy() is not documented to clear a raster one.
  const buildChart = () => {
    const renderCanvas =
      format === 'svg'
        ? canvas.createCanvas(size.width, size.height, 'svg')
        : canvas.createCanvas(size.width, size.height);
    return new Chart(renderCanvas.getContext('2d'), chart);
  };

  let chartInstance;
  try {
    chartInstance = wantsLabelRoom
      ? buildChartWithLabelRoom(chart, size, reserve, buildChart)
      : buildChart();
  } catch (err) {
    // Chart construction failures are config-induced (unknown chart type, bad
    // scale setup, malformed data, ...).
    throw new ChartInputError(err.message || String(err));
  }
  const renderCanvas = chartInstance.canvas;
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
