/**
 * Default formatter for chartjs-plugin-datalabels.
 *
 * The plugin's own default turns an object datum into a listing of its keys,
 * which for the object shapes this server actually renders is never what the
 * caller wanted: a choropleth row `{ feature, value }` comes out as
 * "feature: [object Object], value: 1135", and a `{ x, y }` point as
 * "x: 2, y: 14". This formatter understands those shapes. Anything the caller
 * configures - `options.plugins.datalabels.formatter` or a per-dataset
 * `datalabels.formatter` - still wins over it.
 */

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

// Name over value, one per line - the value alone reads as a stray number on a
// map, and the two together are what a labelled region needs.
function nameAndValue(name, value) {
  const lines = [];
  if (isPresent(name)) {
    lines.push(String(name));
  }
  if (isPresent(value)) {
    lines.push(String(value));
  }
  if (lines.length === 0) {
    return null;
  }
  return lines.length === 1 ? lines[0] : lines;
}

// Members with a text form worth printing. An object renders as
// "[object Object]" and a function as its entire source, neither of which is a
// label; a symbol has no string conversion at all and throws when concatenated.
const LABELLABLE_TYPES = new Set(['string', 'number', 'boolean', 'bigint']);

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

function defaultFormatter(value, context) {
  if (!isPresent(value)) {
    return null;
  }
  if (!isPlainObject(value)) {
    return String(value);
  }

  const type = chartType(context);
  if (type === 'choropleth') {
    // `label` lets a caller name regions in their own language: built-in map
    // features carry English names only.
    const name = isPresent(value.label) ? value.label : featureLabel(value.feature);
    return nameAndValue(name, value.value);
  }
  if (type === 'bubbleMap') {
    return nameAndValue(value.label, value.value);
  }

  if (isPresent(value.label)) {
    return String(value.label);
  }
  // Bubble radius, as the plugin's own default does.
  if (isPresent(value.r)) {
    return String(value.r);
  }
  const axisValue = value[valueAxisKey(context)];
  if (isPresent(axisValue)) {
    return String(axisValue);
  }
  if (isPresent(value.value)) {
    return String(value.value);
  }
  return describePrimitives(value);
}

module.exports = {
  defaultFormatter,
};
