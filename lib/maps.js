/**
 * Registry of built-in TopoJSON maps for geo charts (choropleth/bubbleMap).
 *
 * World and US maps come from the world-atlas and us-atlas npm packages;
 * per-country maps (named by ISO 3166-1 alpha-3 code) are vendored under
 * maps/datamaps/. Names are case-insensitive. Maps are loaded lazily on first
 * use and cached for the process lifetime as converted GeoJSON features.
 */
const fs = require('fs');
const path = require('path');

const { topojson } = require('./chartjs');
const { ChartInputError } = require('./errors');
const { autoProjectionSpec, describeGeometry } = require('./projection');

const DATAMAPS_DIR = path.join(__dirname, '..', 'maps', 'datamaps');

// Atlas maps declare their TopoJSON object key explicitly (the files contain
// several objects, e.g. states-10m.json has both `states` and `nation`).
// Datamaps files contain exactly one object whose key is detected at load.
const ATLAS_MAPS = {
  world: { module: 'world-atlas/countries-110m.json', objectKey: 'countries' },
  'world-50m': { module: 'world-atlas/countries-50m.json', objectKey: 'countries' },
  'world-land': { module: 'world-atlas/land-110m.json', objectKey: 'land' },
  us: { module: 'us-atlas/nation-10m.json', objectKey: 'nation' },
  'us-states': { module: 'us-atlas/states-10m.json', objectKey: 'states' },
  'us-counties': { module: 'us-atlas/counties-10m.json', objectKey: 'counties' },
};

// name -> { file, source, objectKey?, loaded? } where loaded is
// { features, topology } plus lazily-built match indexes.
const registry = new Map();

Object.entries(ATLAS_MAPS).forEach(([name, { module: mod, objectKey }]) => {
  registry.set(name, {
    file: require.resolve(mod),
    source: mod.split('/')[0],
    objectKey,
  });
});

if (fs.existsSync(DATAMAPS_DIR)) {
  fs.readdirSync(DATAMAPS_DIR)
    .filter((filename) => filename.endsWith('.topo.json'))
    .forEach((filename) => {
      const name = filename.slice(0, -'.topo.json'.length).toLowerCase();
      if (!registry.has(name)) {
        registry.set(name, { file: path.join(DATAMAPS_DIR, filename), source: 'datamaps' });
      }
    });
}

function normalizeName(name) {
  return String(name).toLowerCase();
}

function getEntry(name) {
  const entry = registry.get(normalizeName(name));
  if (!entry) {
    throw new ChartInputError(`Unknown map "${name}". See GET /maps for available maps.`);
  }
  return entry;
}

function loadEntry(name) {
  const entry = getEntry(name);
  if (!entry.loaded) {
    const topology = JSON.parse(fs.readFileSync(entry.file, 'utf8'));
    let { objectKey } = entry;
    if (objectKey) {
      if (!topology.objects[objectKey]) {
        // Broken map data (e.g. an atlas package changed shape), not user
        // input: fail loudly instead of silently loading the wrong object.
        throw new Error(
          `Map "${normalizeName(name)}": TopoJSON object "${objectKey}" not found in ${entry.file}`,
        );
      }
    } else {
      objectKey = Object.keys(topology.objects)[0];
    }
    const converted = topojson.feature(topology, topology.objects[objectKey]);
    // topojson.feature returns a FeatureCollection for GeometryCollection
    // objects and a single Feature otherwise.
    const features = converted.type === 'FeatureCollection' ? converted.features : [converted];
    entry.loaded = { features, topology };
  }
  return entry;
}

/**
 * Returns `{ features, topology }` for a built-in map. Cached: repeated calls
 * return the same instances. Throws ChartInputError for unknown names.
 */
function getMap(name) {
  return loadEntry(name).loaded;
}

/**
 * Returns the map's GeoJSON Feature[] for use as a geo dataset `outline`.
 */
function resolveOutline(name) {
  return getMap(name).features;
}

function getMatchIndexes(name) {
  const entry = loadEntry(name);
  if (!entry.indexes) {
    const byName = new Map();
    const byId = new Map();
    entry.loaded.features.forEach((feature) => {
      const featureName = feature.properties && feature.properties.name;
      if (featureName != null && !byName.has(String(featureName).toLowerCase())) {
        byName.set(String(featureName).toLowerCase(), feature);
      }
      if (feature.id != null && !byId.has(String(feature.id).toLowerCase())) {
        byId.set(String(feature.id).toLowerCase(), feature);
      }
    });
    entry.indexes = { byName, byId };
  }
  return entry.indexes;
}

/**
 * Finds a feature in a built-in map by `properties.name` or `id`
 * (case-insensitive, name takes precedence). Throws ChartInputError when
 * nothing matches, hinting at similarly-named features.
 */
function matchFeature(mapName, key) {
  const { byName, byId } = getMatchIndexes(mapName);
  const lower = String(key).toLowerCase();
  const feature = byName.get(lower) || byId.get(lower);
  if (feature) {
    return feature;
  }

  const hints = [...byName.keys()]
    .filter((name) => name.includes(lower) || lower.includes(name))
    .slice(0, 3);
  const hintText = hints.length > 0 ? ` Did you mean: ${hints.join(', ')}?` : '';
  throw new ChartInputError(
    `Unknown feature "${key}" in map "${normalizeName(mapName)}". Features are matched by name or id, case-insensitive; see GET /maps?name=${normalizeName(mapName)} for the full list.${hintText}`,
  );
}

/**
 * The name or id a data row would use to reference this feature (see
 * `matchFeature`), or null for a feature that has neither.
 */
function featureAlias(feature) {
  const name = feature && feature.properties ? feature.properties.name : null;
  if (name !== null && name !== undefined) {
    return String(name);
  }
  return feature && feature.id !== null && feature.id !== undefined ? String(feature.id) : null;
}

/**
 * Returns the map's features with their extents: `[{ feature, bbox }]`, where a
 * bbox is null for a feature that has no measurable one. Cached with the map:
 * measuring every feature of us-counties is not free.
 */
function getFeatureExtents(name) {
  const entry = loadEntry(name);
  if (!entry.extents) {
    entry.extents = entry.loaded.features.map((feature) => ({
      feature,
      bbox: (describeGeometry(feature) || {}).bbox || null,
    }));
  }
  return entry.extents;
}

/**
 * Lists all available maps (without loading them): [{ name, source }].
 */
function listMaps() {
  return [...registry.entries()]
    .map(([name, entry]) => ({ name, source: entry.source }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Returns `{ bbox, centroid, projection }` for a built-in map: its extent, and
 * the projection spec the `auto` keyword would pick for it. Cached alongside
 * the map - measuring us-counties is not free.
 *
 * Note that `bbox[2] < bbox[0]` for the maps that cross the antimeridian.
 */
function getMapGeography(name) {
  const entry = loadEntry(name);
  if (!entry.geography) {
    const measured = describeGeometry(entry.loaded.features) || { bbox: null, centroid: null };
    entry.geography = {
      bbox: measured.bbox,
      centroid: measured.centroid,
      projection: autoProjectionSpec(entry.loaded.features, normalizeName(name)),
    };
  }
  return entry.geography;
}

/**
 * Describes one map for the discovery endpoint, loading it to enumerate the
 * feature names/ids that `matchFeature` accepts.
 */
function describeMap(name) {
  const entry = loadEntry(name);
  return {
    name: normalizeName(name),
    source: entry.source,
    ...getMapGeography(name),
    features: entry.loaded.features.map((feature) => ({
      name: (feature.properties && feature.properties.name) ?? null,
      id: feature.id ?? null,
    })),
  };
}

module.exports = {
  featureAlias,
  getFeatureExtents,
  getMap,
  getMapGeography,
  resolveOutline,
  matchFeature,
  listMaps,
  describeMap,
};
