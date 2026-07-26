/**
 * Declarative d3-geo projection support for geo charts (choropleth/bubbleMap).
 *
 * chartjs-chart-geo's projection scale accepts either the name of a d3
 * projection or a ready-made d3 projection object, but only the name survives
 * a JSON chart config - and a bare name cannot be aimed anywhere, so any map
 * that is not centred on the prime meridian renders off-frame. This module
 * builds projection objects server-side from a plain-JSON spec, derives a
 * sensible one automatically, and frames the view on an arbitrary region.
 *
 * Pure geometry: it knows nothing about the map registry (see lib/maps.js),
 * which keeps the dependency one-way.
 */
const d3geo = require('d3-geo');

const { ChartInputError } = require('./errors');

// Same set (and spelling) as chartjs-chart-geo's own lookup table, so a name
// that works here works there and vice versa.
const PROJECTIONS = {
  azimuthalEqualArea: d3geo.geoAzimuthalEqualArea,
  azimuthalEquidistant: d3geo.geoAzimuthalEquidistant,
  gnomonic: d3geo.geoGnomonic,
  orthographic: d3geo.geoOrthographic,
  stereographic: d3geo.geoStereographic,
  equalEarth: d3geo.geoEqualEarth,
  albers: d3geo.geoAlbers,
  albersUsa: d3geo.geoAlbersUsa,
  conicConformal: d3geo.geoConicConformal,
  conicEqualArea: d3geo.geoConicEqualArea,
  conicEquidistant: d3geo.geoConicEquidistant,
  equirectangular: d3geo.geoEquirectangular,
  mercator: d3geo.geoMercator,
  transverseMercator: d3geo.geoTransverseMercator,
  naturalEarth1: d3geo.geoNaturalEarth1,
};

const PROJECTION_NAMES = Object.keys(PROJECTIONS).sort();

// Maps whose geometry defeats the automatic heuristic below. The US ones span
// the antimeridian via the Aleutians and are ~40% empty Pacific in any single
// projection; albersUsa is the composite d3 provides for exactly that case.
const AUTO_OVERRIDES = {
  us: 'albersUsa',
  'us-states': 'albersUsa',
  'us-counties': 'albersUsa',
  usa: 'albersUsa',
  world: 'equalEarth',
  'world-50m': 'equalEarth',
  'world-land': 'equalEarth',
};

// Beyond these spans a conic projection is the wrong tool and the whole-globe
// default reads better.
const GLOBAL_LON_SPAN = 200;
const GLOBAL_LAT_SPAN = 120;

// Degrees between sampled points along a bounding-box edge. Box edges are
// great-circle arcs once projected, so they need sampling to bound correctly.
const BBOX_STEP = 2;

function lookupFactory(name) {
  // chartjs-chart-geo registers both `mercator` and `geoMercator`; accept both.
  const key = /^geo[A-Z]/.test(name) ? `${name.charAt(3).toLowerCase()}${name.slice(4)}` : name;
  return PROJECTIONS[key] || null;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberTuple(value, min, max, label) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new ChartInputError(
      `Projection "${label}" must be an array of ${min === max ? min : `${min}-${max}`} numbers`,
    );
  }
  if (!value.every(isFiniteNumber)) {
    throw new ChartInputError(`Projection "${label}" must contain only finite numbers`);
  }
  return value;
}

// Chainable d3 projection setters that are meaningful before the scale fits
// the projection to the chart area. `scale`/`translate` are deliberately
// absent: the fit overwrites both (use projectionScale/projectionOffset).
const SETTERS = {
  rotate: (value) => numberTuple(value, 2, 3, 'rotate'),
  center: (value) => numberTuple(value, 2, 2, 'center'),
  parallels: (value) => numberTuple(value, 2, 2, 'parallels'),
  clipAngle: (value) => {
    if (!isFiniteNumber(value)) {
      throw new ChartInputError('Projection "clipAngle" must be a number');
    }
    return value;
  },
  clipExtent: (value) => {
    if (value === null) {
      return value;
    }
    if (!Array.isArray(value) || value.length !== 2) {
      throw new ChartInputError('Projection "clipExtent" must be [[x0, y0], [x1, y1]] or null');
    }
    value.forEach((corner) => numberTuple(corner, 2, 2, 'clipExtent'));
    return value;
  },
  precision: (value) => {
    if (!isFiniteNumber(value) || value <= 0) {
      throw new ChartInputError('Projection "precision" must be a number greater than 0');
    }
    return value;
  },
  angle: (value) => {
    if (!isFiniteNumber(value)) {
      throw new ChartInputError('Projection "angle" must be a number');
    }
    return value;
  },
  reflectX: (value) => {
    if (typeof value !== 'boolean') {
      throw new ChartInputError('Projection "reflectX" must be a boolean');
    }
    return value;
  },
  reflectY: (value) => {
    if (typeof value !== 'boolean') {
      throw new ChartInputError('Projection "reflectY" must be a boolean');
    }
    return value;
  },
};

const SETTER_NAMES = Object.keys(SETTERS).sort();

/**
 * True for the object form of a projection option, i.e. `{ type, rotate, ... }`
 * as opposed to a name string or an already-built d3 projection function.
 */
function isProjectionSpec(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validates a projection name, returning it unchanged. Throws a 400 for
 * unknown names, which chartjs-chart-geo would otherwise swallow by silently
 * falling back to albersUsa.
 */
function validateProjectionName(name) {
  if (!lookupFactory(name)) {
    throw new ChartInputError(
      `Unknown projection "${name}". Available projections: ${PROJECTION_NAMES.join(', ')}.`,
    );
  }
  return name;
}

/**
 * Builds a d3 projection from a plain-JSON spec such as
 * `{ type: 'conicEqualArea', rotate: [-100, 0], parallels: [50, 70] }`.
 *
 * Always returns a fresh object: the projection scale mutates it in place
 * (scale/translate) while fitting, so instances must not be shared between
 * requests.
 */
function buildProjection(spec) {
  if (!isProjectionSpec(spec)) {
    throw new ChartInputError('Projection must be a name or an object with a "type"');
  }
  const { type } = spec;
  if (typeof type !== 'string') {
    throw new ChartInputError(
      `Projection object needs a "type" naming a projection. Available projections: ${PROJECTION_NAMES.join(', ')}.`,
    );
  }
  const factory = lookupFactory(type);
  if (!factory) {
    validateProjectionName(type);
  }
  const projection = factory();

  Object.keys(spec).forEach((key) => {
    if (key === 'type') {
      return;
    }
    const validate = SETTERS[key];
    if (!validate) {
      if (key === 'scale' || key === 'translate') {
        throw new ChartInputError(
          `Projection "${key}" is overwritten when the map is fitted to the chart area. Use the scale's projectionScale/projectionOffset options instead.`,
        );
      }
      throw new ChartInputError(
        `Unknown projection option "${key}". Supported: type, ${SETTER_NAMES.join(', ')}.`,
      );
    }
    if (typeof projection[key] !== 'function') {
      // e.g. albersUsa is a composite and supports none of the aiming setters.
      throw new ChartInputError(`Projection "${type}" does not support "${key}"`);
    }
    projection[key](validate(spec[key]));
  });

  return projection;
}

/**
 * Wraps loose GeoJSON input - a Feature[], a FeatureCollection, a geometry, or
 * null - into something d3-geo can measure. Returns null when there is nothing
 * to measure.
 */
function toGeoJson(value) {
  if (!value) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? { type: 'FeatureCollection', features: value } : null;
  }
  return typeof value === 'object' && value.type ? value : null;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

// d3-geo throws a TypeError on structurally malformed geometry - an empty
// coordinate array, say - rather than reporting no extent. For our purposes the
// two answers are the same, and caller-supplied geometry must not reach the
// HTTP layer as a 500.
function tryMeasure(measurer, geo) {
  try {
    return measurer(geo);
  } catch {
    return null;
  }
}

/**
 * Measures a GeoJSON value: `{ bbox: [w, s, e, n], centroid: [lon, lat] }`, or
 * null if it has no finite extent. Note that `bbox[2] < bbox[0]` when the
 * geometry crosses the antimeridian - d3 reports the *smallest* enclosing
 * longitude range, not a left-to-right one.
 */
function describeGeometry(value) {
  const geo = toGeoJson(value);
  if (!geo) {
    return null;
  }
  const bounds = tryMeasure(d3geo.geoBounds, geo);
  if (!bounds) {
    return null;
  }
  const [[west, south], [east, north]] = bounds;
  if (![west, south, east, north].every(isFiniteNumber)) {
    return null;
  }
  const centroid = tryMeasure(d3geo.geoCentroid, geo);
  return {
    bbox: [round(west), round(south), round(east), round(north)],
    centroid:
      centroid && centroid.every(isFiniteNumber) ? [round(centroid[0]), round(centroid[1])] : null,
  };
}

/**
 * Derives a projection spec that frames `outline` sensibly, given the built-in
 * map name it came from (used only to consult the override table).
 *
 * The recipe is the standard d3 one: rotate the globe so the region's centroid
 * meridian faces the viewer, then use a conic equal-area projection with
 * standard parallels at 1/6 and 5/6 of the latitude range. Rotating by
 * longitude alone leaves latitudes untouched, so the parallels can be read
 * straight off the unrotated bounds.
 *
 * The centroid - not the bounding-box midpoint - sets the rotation: a region
 * crossing the antimeridian (Russia, Fiji, New Zealand) has a bounding box
 * whose midpoint lands on the far side of the planet.
 */
function autoProjectionSpec(outline, mapName) {
  const override = mapName ? AUTO_OVERRIDES[String(mapName).toLowerCase()] : null;
  if (override) {
    return { type: override };
  }

  const geo = toGeoJson(outline);
  if (!geo) {
    return { type: 'equalEarth' };
  }
  const centroid = tryMeasure(d3geo.geoCentroid, geo);
  if (!centroid || !isFiniteNumber(centroid[0])) {
    return { type: 'equalEarth' };
  }
  const lon0 = centroid[0];

  const measured = measureRotated(geo, lon0);
  if (!measured) {
    return { type: 'equalEarth' };
  }
  const { lonSpan, south, north } = measured;
  const latSpan = north - south;
  if (lonSpan > GLOBAL_LON_SPAN || latSpan > GLOBAL_LAT_SPAN) {
    return { type: 'equalEarth' };
  }

  return {
    type: 'conicEqualArea',
    rotate: [round(-lon0), 0],
    center: [0, round((south + north) / 2)],
    parallels: [round(south + latSpan / 6), round(north - latSpan / 6)],
  };
}

function normalizeLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function forEachPosition(node, visit) {
  if (!node || typeof node !== 'object') {
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => forEachPosition(child, visit));
    return;
  }
  switch (node.type) {
    case 'FeatureCollection':
      forEachPosition(node.features, visit);
      return;
    case 'Feature':
      forEachPosition(node.geometry, visit);
      return;
    case 'GeometryCollection':
      forEachPosition(node.geometries, visit);
      return;
    default:
      break;
  }
  if (node.coordinates) {
    visitCoordinates(node.coordinates, visit);
  }
}

function visitCoordinates(coordinates, visit) {
  if (typeof coordinates[0] === 'number') {
    visit(coordinates[0], coordinates[1]);
    return;
  }
  coordinates.forEach((child) => visitCoordinates(child, visit));
}

/**
 * Measures a geometry's extent in the frame rotated to `lon0`, returning
 * `{ lonSpan, south, north }` or null if it has no vertices.
 *
 * The rotated frame is what makes this reliable near the antimeridian.
 * d3.geoBounds reports a longitude range in the unrotated frame, and for a
 * country whose polygons are split at 180 - Fiji, Kiribati, Tuvalu in the
 * vendored data - that range is the full 360 degrees even though the country
 * is a few degrees wide. Rotating first collapses it to the real span.
 * Latitudes are unaffected by a longitude-only rotation.
 */
function measureRotated(geo, lon0) {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let south = Infinity;
  let north = -Infinity;

  forEachPosition(geo, (lon, lat) => {
    if (!isFiniteNumber(lon) || !isFiniteNumber(lat)) {
      return;
    }
    const rotated = normalizeLon(lon - lon0);
    minLon = Math.min(minLon, rotated);
    maxLon = Math.max(maxLon, rotated);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  });

  if (minLon === Infinity) {
    return null;
  }
  return { lonSpan: maxLon - minLon, south, north };
}

/**
 * Turns `[west, south, east, north]` into a densified LineString tracing the
 * box, for use as a projection fit target.
 *
 * A LineString rather than a Polygon on purpose: d3-geo reads a polygon's ring
 * winding to decide which side is the interior, and a box wound the "wrong"
 * way silently becomes the whole sphere minus the box - which fits to the
 * globe instead of the region. A LineString has no interior and no winding.
 */
function bboxOutline(bbox) {
  numberTuple(bbox, 4, 4, 'bbox');
  const [west, south, east, north] = bbox;
  if (south < -90 || north > 90 || south >= north) {
    throw new ChartInputError(
      'Projection "fit" bbox must be [west, south, east, north] with -90 <= south < north <= 90',
    );
  }
  const lonSpan = east >= west ? east - west : east + 360 - west;
  if (lonSpan <= 0 || lonSpan > 360) {
    throw new ChartInputError('Projection "fit" bbox must span a positive longitude range');
  }

  const latSpan = north - south;
  const lonSteps = Math.max(1, Math.ceil(lonSpan / BBOX_STEP));
  const latSteps = Math.max(1, Math.ceil(latSpan / BBOX_STEP));
  const coordinates = [];
  const push = (lon, lat) => coordinates.push([normalizeLon(lon), lat]);

  for (let i = 0; i <= lonSteps; i += 1) {
    push(west + (lonSpan * i) / lonSteps, south);
  }
  for (let i = 1; i <= latSteps; i += 1) {
    push(west + lonSpan, south + (latSpan * i) / latSteps);
  }
  for (let i = 1; i <= lonSteps; i += 1) {
    push(west + lonSpan - (lonSpan * i) / lonSteps, north);
  }
  for (let i = 1; i <= latSteps; i += 1) {
    push(west, north - (latSpan * i) / latSteps);
  }

  return { type: 'LineString', coordinates };
}

/**
 * Plugin that frames the projection on `geometry` instead of on the dataset
 * outline, so a chart can draw one thing and be framed on another. Whatever
 * falls outside the chart area is cut by the controller's own `clipMap`.
 *
 * `beforeDatasetUpdate` (singular) is the only hook positioned between
 * GeoController.linkScales(), which fits the projection to the dataset
 * outline, and the controller update that reads the fitted bounds - an earlier
 * hook is simply overwritten by linkScales.
 */
function createFitPlugin(geometry) {
  return {
    id: 'quickchart-geo-fit',
    beforeDatasetUpdate(chart) {
      const scale = chart.scales.projection;
      if (scale && typeof scale.computeBounds === 'function') {
        scale.computeBounds(geometry);
      }
    },
  };
}

module.exports = {
  PROJECTION_NAMES,
  PROJECTION_OPTION_NAMES: SETTER_NAMES,
  autoProjectionSpec,
  bboxOutline,
  buildProjection,
  createFitPlugin,
  describeGeometry,
  isProjectionSpec,
  toGeoJson,
  validateProjectionName,
};
