/* eslint-env node, mocha */

const assert = require('assert');

const { imageSize } = require('image-size');

const { renderChartJs } = require('../../lib/charts');
const { BASIC_CONFIGS, PLUGIN_CONFIGS } = require('../fixtures/chart_configs');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function assertValidPng(buf, width, height) {
  assert(Buffer.isBuffer(buf), 'expected a Buffer');
  assert(buf.subarray(0, 8).equals(PNG_MAGIC), 'expected PNG magic bytes');
  const dimensions = imageSize(buf);
  assert.strictEqual(dimensions.width, width);
  assert.strictEqual(dimensions.height, height);
}

describe('basic chart types render', () => {
  Object.entries(BASIC_CONFIGS).forEach(([name, config]) => {
    it(`renders ${name}`, async () => {
      // Deep-clone: renderChartJs mutates its input.
      const chart = JSON.parse(JSON.stringify(config));
      const buf = await renderChartJs(500, 300, 'white', 1.0, undefined, 'png', chart);
      assertValidPng(buf, 500, 300);
    });
  });
});

describe('plugin chart types render', () => {
  Object.entries(PLUGIN_CONFIGS).forEach(([name, config]) => {
    it(`renders ${name}`, async () => {
      const chart = JSON.parse(JSON.stringify(config));
      const buf = await renderChartJs(500, 300, 'white', 1.0, undefined, 'png', chart);
      assertValidPng(buf, 500, 300);
    });
  });
});
