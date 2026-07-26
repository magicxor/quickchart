/* eslint-env node, mocha */

const assert = require('assert');

const { getMap, resolveOutline, matchFeature, listMaps, describeMap } = require('../../lib/maps');
const { ChartInputError } = require('../../lib/errors');

describe('map registry', () => {
  it('lists the atlas maps and vendored countries', () => {
    const names = new Set(listMaps().map((m) => m.name));
    ['world', 'world-50m', 'world-land', 'us', 'us-states', 'us-counties'].forEach((name) => {
      assert(names.has(name), `expected atlas map ${name}`);
    });
    ['deu', 'fra', 'jpn', 'usa'].forEach((name) => {
      assert(names.has(name), `expected datamaps country ${name}`);
    });
    // All ~254 vendored countries plus the 6 atlas maps.
    assert(names.size > 250, `expected 250+ maps, got ${names.size}`);
  });

  it('lists a source for every map', () => {
    for (const entry of listMaps()) {
      assert(['world-atlas', 'us-atlas', 'datamaps'].includes(entry.source), entry.source);
    }
  });

  it('loads maps lazily and caches them', () => {
    const first = getMap('world');
    assert(Array.isArray(first.features) && first.features.length > 100);
    assert.strictEqual(first.topology.type, 'Topology');
    // Same instance on repeat access, including case-insensitive names.
    assert.strictEqual(getMap('world'), first);
    assert.strictEqual(getMap('WORLD'), first);
  });

  it('resolves single-outline maps to one feature', () => {
    assert.strictEqual(resolveOutline('world-land').length, 1);
    assert.strictEqual(resolveOutline('us').length, 1);
  });

  it('throws a 400 ChartInputError for an unknown map', () => {
    assert.throws(
      () => getMap('atlantis'),
      (err) =>
        err instanceof ChartInputError &&
        err.statusCode === 400 &&
        err.message.includes('atlantis'),
    );
  });

  it('matches features by name, case-insensitively', () => {
    assert.strictEqual(matchFeature('world', 'Germany').properties.name, 'Germany');
    assert.strictEqual(matchFeature('world', 'gErMaNy').properties.name, 'Germany');
    assert.strictEqual(matchFeature('us-states', 'california').properties.name, 'California');
  });

  it('matches features by id', () => {
    // world-atlas ids are ISO 3166-1 numeric ("276" = Germany).
    assert.strictEqual(matchFeature('world', '276').properties.name, 'Germany');
    // us-atlas ids are FIPS codes ("06" = California).
    assert.strictEqual(matchFeature('us-states', '06').properties.name, 'California');
    // datamaps subunit ids ("DE.BE" = Berlin).
    assert.strictEqual(matchFeature('deu', 'de.be').properties.name, 'Berlin');
  });

  it('throws a 400 ChartInputError for an unknown feature', () => {
    assert.throws(
      () => matchFeature('world', 'Atlantis'),
      (err) =>
        err instanceof ChartInputError &&
        err.statusCode === 400 &&
        err.message.includes('Atlantis') &&
        err.message.includes('world'),
    );
  });

  it('describes a map with its matchable features', () => {
    const description = describeMap('deu');
    assert.strictEqual(description.name, 'deu');
    assert.strictEqual(description.source, 'datamaps');
    const berlin = description.features.find((f) => f.name === 'Berlin');
    assert(berlin, 'expected a Berlin feature');
    assert.strictEqual(berlin.id, 'DE.BE');
  });
});
