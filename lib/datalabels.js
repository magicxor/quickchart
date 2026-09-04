/**
 * Default formatter for chartjs-plugin-datalabels.
 *
 * The plugin's own default turns an object datum into a listing of its keys,
 * which for the object shapes this server actually renders is never what the
 * caller wanted: a choropleth row `{ feature, value }` comes out as
 * "feature: [object Object], value: 1135", and a `{ x, y }` point as
 * "x: 2, y: 14". This formatter understands those shapes, and a row's own
 * `label` comes first wherever the row has one: a string, or an array of
 * strings for one line each, which is how a region gets a name in another
 * language or a value gets a comment under it.
 */
const { ChartInputError } = require('./errors');

// Matches chart.js's own `isObject`: an array is a datum in its own right
// (boxplot/violin), not a bag of options to pick a field out of.
function isPlainObject(value) {
  return value !== null && Object.prototype.toString.call(value) === '[object Object]';
}

function isPresent(value) {
  return value !== null && value !== undefined;
}

// GeoJSON feature name, as `matchFeature` leaves it on a resolved data row:
// the name lives under `properties`, and some datamaps subdivisions only have
// an id.
function featureLabel(feature) {
  if (!feature || typeof feature !== 'object') {
    return null;
  }
  const name = feature.properties && feature.properties.name;
  if (isPresent(name)) {
    return name;
  }
  return isPresent(feature.id) ? feature.id : null;
}

// Members with a text form worth printing. An object renders as
// "[object Object]" and a function as its entire source, neither of which is a
// label; a symbol has no string conversion at all and throws when concatenated.
const LABELLABLE_TYPES = new Set(['string', 'number', 'boolean', 'bigint']);

// The member's text, or null if it has none. Data is caller-supplied and may be
// mis-shaped - a `value` that is an object rather than a number - and printing
// that as "[object Object]" is what this formatter exists to prevent.
function asLabelText(value) {
  return LABELLABLE_TYPES.has(typeof value) ? String(value) : null;
}

// The lines a member contributes to a label: one for a primitive, one per
// readable element for an array, none for anything else.
function labelLines(member) {
  const parts = Array.isArray(member) ? member : [member];
  return parts.map(asLabelText).filter((line) => line !== null);
}

// What the plugin draws for a list of lines: a string for one, an array for
// several (one per line), null for none.
function fromLines(lines) {
  if (lines.length === 0) {
    return null;
  }
  return lines.length === 1 ? lines[0] : lines;
}

// The member's text: a string, an array of strings for a multi-line `label`,
// or null if it has none.
function labelText(member) {
  return fromLines(labelLines(member));
}

// Name over value, one per line - the value alone reads as a stray number on a
// map, and the two together are what a labelled region needs. A multi-line
// name keeps its lines, with the value under the last.
function nameAndValue(name, value) {
  return fromLines([...labelLines(name), ...labelLines(value)]);
}

// Last resort for an object shape this formatter does not know: the plugin's
// own key listing, over the members that can be read as text.
function describePrimitives(value) {
  const parts = Object.keys(value)
    .filter((key) => LABELLABLE_TYPES.has(typeof value[key]))
    .map((key) => `${key}: ${value[key]}`);
  return parts.length > 0 ? parts.join(', ') : null;
}

function chartType(context) {
  const datasetType = context.dataset && context.dataset.type;
  if (datasetType) {
    return datasetType;
  }
  return context.chart && context.chart.config ? context.chart.config.type : undefined;
}

// The axis carrying the measured value: `indexAxis` names the category one.
function valueAxisKey(context) {
  const options = context.chart && context.chart.options;
  return options && options.indexAxis === 'y' ? 'x' : 'y';
}

// The name of the datum's category, i.e. its entry in `data.labels`.
function indexLabel(context) {
  const data = context.chart && context.chart.data;
  const labels = data && data.labels;
  return Array.isArray(labels) ? labels[context.dataIndex] : null;
}

// The datum's measured value: a bare number, or the value-carrying member of an
// object datum.
function measuredValue(value, context) {
  if (!isPlainObject(value)) {
    return value;
  }
  return isPresent(value[valueAxisKey(context)]) ? value[valueAxisKey(context)] : value.value;
}

function defaultFormatter(value, context) {
  if (!isPresent(value)) {
    return null;
  }

  const type = chartType(context);
  // A funnel draws no axes at all, so a stage's name has nowhere else to
  // appear: it belongs on the layer, above the value.
  if (type === 'funnel') {
    return nameAndValue(indexLabel(context), measuredValue(value, context));
  }
  if (!isPlainObject(value)) {
    return String(value);
  }

  if (type === 'choropleth') {
    // `label` lets a caller name regions in their own language: built-in map
    // features carry English names only. A label with no text in it - an
    // object where a string belongs - leaves the region its map name.
    const name = labelText(value.label) !== null ? value.label : featureLabel(value.feature);
    return nameAndValue(name, value.value);
  }
  if (type === 'bubbleMap') {
    return nameAndValue(value.label, value.value);
  }

  // The most specific member that has a text form: the caller's own label, a
  // bubble radius (as the plugin's own default does), the value-axis
  // coordinate, then a bare `value`. Only `label` may span several lines: an
  // array elsewhere is a datum of its own shape (a floating bar's `[min, max]`).
  const label = labelText(value.label);
  if (label !== null) {
    return label;
  }
  const candidates = [value.r, value[valueAxisKey(context)], value.value];
  for (const candidate of candidates) {
    const text = asLabelText(candidate);
    if (text !== null) {
      return text;
    }
  }
  return describePrimitives(value);
}

/**
 * The two values chart.js reads as "this plugin is switched off" for a chart -
 * see its own `getOpts`, which drops the plugin's descriptor for either, so not
 * one of its hooks runs.
 *
 * `0` and `''` are deliberately not among them: chart.js keeps the plugin for
 * those and hands it the falsy value as its options, which merges over the
 * defaults as nothing and leaves labels on.
 */
function dataLabelsOff(options) {
  return options === false || options === null;
}

/**
 * Whether the caller said anything about datalabels that chart.js or the plugin
 * can act on: an options object, `true` for the plugin's own defaults, or the
 * two off values above.
 *
 * `applyQuickchartDefaults` fills in this server's historical default for
 * everything else - `undefined`, and the stray `0` or `''` a templating layer
 * produces, which would otherwise reach the plugin as options and turn labels on
 * for a chart type that has always had them off.
 */
function configuresDataLabels(options) {
  return dataLabelsOff(options) || options === true || isPlainObject(options);
}

// Whether one label configuration could produce a label. `display` is
// scriptable, so only a literal `false` settles the question here; an absent one
// means the plugin's own default, which is to display.
function configMayDisplay(config) {
  return config.display !== false;
}

/**
 * Whether one dataset could draw a label, resolved the way
 * chartjs-plugin-datalabels' own `configure` resolves it: the dataset's
 * `datalabels` merged over the chart-level options, then split into the named
 * label groups when there are any.
 *
 * A shallow merge is enough for this question - `display` is a scalar, so the
 * dataset's own wins whenever it has one, and `labels` is the only other member
 * read here.
 */
function datasetMayDrawLabels(base, dataset) {
  const override = dataset.datalabels;
  if (override === false) {
    // `configure` returns null for such a dataset: it draws nothing at all,
    // whatever the chart-level options say.
    return false;
  }
  // `true` means "no overrides of my own", i.e. exactly the chart-level options.
  const overrides = isPlainObject(override) ? override : {};
  const merged = { ...base, ...overrides };
  const groups = { ...base.labels, ...overrides.labels };
  const keys = Object.keys(groups);
  if (keys.length === 0) {
    return configMayDisplay(merged);
  }
  return keys.some((key) => {
    const group = groups[key];
    // A falsy named group is skipped outright, drawing nothing; a group without
    // a `display` of its own inherits the merged one.
    if (!isPlainObject(group)) {
      return false;
    }
    return configMayDisplay({ ...merged, ...group });
  });
}

/**
 * Whether the chart could draw a data label, for work that only a label would
 * ever read: geo charts measure a label anchor per region (see
 * `createLabelAnchorPlugin`), which on a detailed map is hundreds of
 * measurements to throw away.
 *
 * False only where the config settles it - the plugin switched off, or every
 * dataset resolving to `display: false`. That is the common case here, since
 * every type but the axisless ones defaults to no labels. Being wrong in this
 * direction costs a chart its label positions and nothing says so, so anything
 * less definite than a literal `false` counts as "could".
 */
function mayDrawDataLabels(chart) {
  const plugins = chart.options ? chart.options.plugins : null;
  const options = plugins ? plugins.datalabels : undefined;
  // Switched off for the whole chart, which no dataset can undo: chart.js never
  // gives the plugin a hook to resolve one in.
  if (dataLabelsOff(options)) {
    return false;
  }
  const base = isPlainObject(options) ? options : {};
  const datasets = chart.data && Array.isArray(chart.data.datasets) ? chart.data.datasets : [];
  // Per dataset, because that is the level the plugin resolves `display` at: a
  // chart-level `false` that one dataset turns back on draws labels, and a
  // chart-level `true` that every dataset turns off draws none.
  return datasets.some((dataset) => dataset && datasetMayDrawLabels(base, dataset));
}

/**
 * Rejects the one `datalabels` value chartjs-plugin-datalabels cannot render.
 *
 * Its `configure` answers null for a dataset that says `datalabels: false` - the
 * "this dataset draws no labels at all" that its types and its documentation
 * never mention but its code implements - and then dereferences that null in the
 * same hook, twice over: `config.labels` for a dataset that has points,
 * `config.listeners` for one that does not. Either way the render dies with a
 * TypeError, which reaches the caller as a 400 reading "Cannot read properties
 * of null" and naming no way out of it.
 *
 * Every other shape renders: `true` reads as "no overrides of my own", and a
 * value that is not an object at all merges over the chart-level options as
 * nothing. Nor is the chart-level option affected - and a chart that switches the
 * plugin off there is not affected either, since the hook that trips over the
 * dataset never runs, so there is nothing to refuse.
 */
function validateDataLabels(chart) {
  const plugins = chart.options ? chart.options.plugins : null;
  if (dataLabelsOff(plugins ? plugins.datalabels : undefined)) {
    return;
  }
  const datasets = chart.data && Array.isArray(chart.data.datasets) ? chart.data.datasets : [];
  datasets.forEach((dataset, index) => {
    if (dataset && dataset.datalabels === false) {
      throw new ChartInputError(
        `Dataset ${index}: "datalabels": false is not supported on a dataset. Turn labels off for one dataset with "datalabels": { "display": false }.`,
      );
    }
  });
}

module.exports = {
  configuresDataLabels,
  defaultFormatter,
  mayDrawDataLabels,
  validateDataLabels,
};
