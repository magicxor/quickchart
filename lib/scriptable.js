/**
 * Compiles quoted Javascript out of a chart config.
 *
 * Chart.js takes functions for a large number of its options - the datalabels
 * `formatter`, `ticks.callback`, the tooltip callbacks, scriptable colors - and
 * a config sent as strict JSON has no way to hold one. Callers reach for the
 * obvious next thing and quote the source:
 *
 *   { "plugins": { "datalabels": { "formatter": "function(v) { return v.y; }" } } }
 *
 * Chart.js and its plugins then see a string where they expect a function.
 * Nothing errors: the datalabels plugin falls back to stringifying the raw
 * datum ("[object Object]" for object data) and a quoted `display` is simply
 * truthy, so labels appear where the caller meant to hide them. This turns
 * those strings back into functions before the chart is built.
 *
 * Only string values under the option names below are considered, and only when
 * they look like a function definition - and for names that mean different
 * things in different places (`label` is a legend entry on a dataset and a
 * callback under a tooltip), only where Chart.js takes a function. Ordinary
 * text is left alone.
 *
 * A compiled source then runs like any other Javascript in a config. A config
 * passed as a string has always been evaluated wholesale (see `renderChartJs`),
 * so the service's trust model is unchanged - but a JSON body is no longer
 * inert either, and README's "Securing your self-hosted instance" covers both.
 */
const { ChartInputError } = require('./errors');

// Option names that Chart.js, its plugins, or this server accept a function for.
// Deliberately absent: `text`, `name` and other purely textual options.
const FUNCTION_OPTION_KEYS = new Set([
  // chartjs-plugin-datalabels
  'formatter',
  'display',
  'align',
  'anchor',
  'clamp',
  'clip',
  'offset',
  'opacity',
  'padding',
  'rotation',
  'textAlign',
  'textStrokeColor',
  'textStrokeWidth',
  'textShadowBlur',
  'textShadowColor',
  'font',
  // Scriptable colors, borders and point styling on datasets and elements
  'color',
  'backgroundColor',
  'borderColor',
  'borderWidth',
  'borderDash',
  'borderRadius',
  'hoverBackgroundColor',
  'hoverBorderColor',
  'hoverBorderWidth',
  'pointBackgroundColor',
  'pointBorderColor',
  'pointRadius',
  'pointStyle',
  'pointHoverRadius',
  'radius',
  'segment',
  'fill',
  // Scales: tick callbacks and styling, the time parser, geo color interpolation
  'callback',
  'tickColor',
  'tickWidth',
  'tickBorderDash',
  'backdropColor',
  'parser',
  'interpolate',
  // options.plugins.tooltip.callbacks (`title`, `label` and `footer` are
  // ordinary text elsewhere - see SCOPED_FUNCTION_KEYS)
  'beforeTitle',
  'afterTitle',
  'beforeBody',
  'afterBody',
  'beforeLabel',
  'afterLabel',
  'beforeFooter',
  'afterFooter',
  'labelColor',
  'labelTextColor',
  'labelPointStyle',
  'filter',
  'itemSort',
  'sort',
  // options.plugins.legend
  'generateLabels',
  'onClick',
  'onHover',
  'onLeave',
  // chartjs-plugin-annotation
  'init',
]);

// Names that are a function in one place and ordinary text in another: a
// dataset's `label` is what the legend shows, `label` inside the tooltip's
// `callbacks` is a function; an annotation's `content` is a function or the
// text of the annotation, while `content` elsewhere is neither. Compiling
// these anywhere would turn a legend entry reading "x => y" into a function -
// or into a 400, if its "body" happens not to parse.
const inTooltipCallbacks = (parentPath) => parentPath.endsWith('callbacks');
const inAnnotationOptions = (parentPath) => /(^|\.)annotation(\.|$)/.test(parentPath);

const SCOPED_FUNCTION_KEYS = new Map([
  ['title', inTooltipCallbacks],
  ['label', inTooltipCallbacks],
  ['footer', inTooltipCallbacks],
  ['content', inAnnotationOptions],
  ['value', inAnnotationOptions],
  ['endValue', inAnnotationOptions],
]);

// Whether a string under this key, at this point in the config, is source code
// rather than text. `parentPath` is the path of the object holding the key.
function takesFunction(key, parentPath) {
  if (FUNCTION_OPTION_KEYS.has(key)) {
    return true;
  }
  const inScope = SCOPED_FUNCTION_KEYS.get(key);
  return inScope !== undefined && inScope(parentPath);
}

// Arrays that hold data rather than options: dataset data, category labels, and
// the GeoJSON of an inline map. Nothing in them is scriptable, and an inline
// map's coordinate rings are large enough to be worth not walking.
const DATA_ARRAY_KEYS = new Set(['data', 'labels', 'outline', 'features', 'coordinates']);

// A function expression or arrow function, as opposed to a string that merely
// mentions one. The body is not inspected here - `compileSource` parses it.
const FUNCTION_SOURCE =
  /^\s*(?:async\s+)?(?:function\s*\*?\s*[\w$]*\s*\(|\(\s*[^()]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/;

function isWalkable(value) {
  return Boolean(value) && typeof value === 'object';
}

function compileSource(source, path) {
  let compiled;
  try {
    // eslint-disable-next-line no-new-func
    compiled = new Function(`return (${source});`)();
  } catch (err) {
    throw new ChartInputError(
      `Option "${path}" looks like a Javascript function but does not parse: ${err.message}`,
    );
  }
  // A string that matched the pattern but produced something else (an object
  // literal shorthand, say) is left as the caller wrote it.
  return typeof compiled === 'function' ? compiled : null;
}

function walk(container, path) {
  Object.keys(container).forEach((key) => {
    const value = container[key];
    const childPath = path ? `${path}.${key}` : key;

    if (typeof value === 'string') {
      if (takesFunction(key, path) && FUNCTION_SOURCE.test(value)) {
        const compiled = compileSource(value, childPath);
        if (compiled) {
          container[key] = compiled;
        }
      }
      return;
    }

    if (Array.isArray(value)) {
      if (DATA_ARRAY_KEYS.has(key)) {
        return;
      }
      value.forEach((item, index) => {
        if (isWalkable(item)) {
          walk(item, `${childPath}[${index}]`);
        }
      });
      return;
    }

    if (isWalkable(value)) {
      walk(value, childPath);
    }
  });
}

/**
 * Replaces quoted function sources in a chart config with real functions, in
 * place. Throws ChartInputError (HTTP 400) for a string that looks like a
 * function but does not parse - the caller meant it as code, and rendering it
 * as a label instead would be a silent wrong answer.
 */
function compileFunctionStrings(chart) {
  if (!isWalkable(chart) || Array.isArray(chart)) {
    return;
  }
  walk(chart, '');
}

module.exports = {
  compileFunctionStrings,
};
