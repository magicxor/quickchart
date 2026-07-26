/* eslint-env node, mocha */

/**
 * End-to-end tests: build the Docker image from the repo Dockerfile, start a
 * container, exercise the HTTP API with every supported chart type, and tear
 * the container down.
 *
 * Run with: npm run test:e2e (requires a running Docker daemon; not part of
 * the regular `npm test` suite).
 */

const assert = require('assert');
const path = require('path');

const { GenericContainer, Wait } = require('testcontainers');

const { BASIC_CONFIGS, PLUGIN_CONFIGS } = require('../fixtures/chart_configs');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IMAGE_NAME = 'quickchart-e2e:latest';
const APP_PORT = 3400;

describe('quickchart e2e (docker)', function () {
  // Building the image dominates the runtime: node-canvas compiles from
  // source on Alpine, which can take several minutes on a cold cache.
  this.timeout(900000);

  let container;
  let baseUrl;

  before(async () => {
    const buildContext = path.resolve(__dirname, '..', '..');
    const image = await GenericContainer.fromDockerfile(buildContext).build(IMAGE_NAME, {
      deleteOnExit: false,
    });
    container = await image
      .withExposedPorts(APP_PORT)
      .withWaitStrategy(Wait.forHttp('/healthcheck', APP_PORT).forStatusCode(200))
      .start();
    baseUrl = `http://${container.getHost()}:${container.getMappedPort(APP_PORT)}`;
  });

  after(async () => {
    if (container) {
      await container.stop();
    }
  });

  async function postChart(chartConfig, extraBody = {}) {
    return fetch(`${baseUrl}/chart`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chart: chartConfig, ...extraBody }),
    });
  }

  async function assertPngResponse(res) {
    assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    assert.strictEqual(res.headers.get('content-type'), 'image/png');
    assert.strictEqual(
      res.headers.get('x-quickchart-error'),
      null,
      `unexpected chart error: ${res.headers.get('x-quickchart-error')}`,
    );
    const buf = Buffer.from(await res.arrayBuffer());
    assert(buf.subarray(0, 8).equals(PNG_MAGIC), 'expected PNG magic bytes');
    assert(buf.length > 500, 'expected non-trivial PNG output');
    return buf;
  }

  describe('healthcheck', () => {
    it('reports success', async () => {
      const res = await fetch(`${baseUrl}/healthcheck`);
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
    });
  });

  describe('basic chart types', () => {
    Object.entries(BASIC_CONFIGS).forEach(([name, config]) => {
      it(`renders ${name} as png`, async () => {
        const res = await postChart(config);
        await assertPngResponse(res);
      });
    });
  });

  describe('plugin chart types', () => {
    Object.entries(PLUGIN_CONFIGS).forEach(([name, config]) => {
      it(`renders ${name} as png`, async () => {
        const res = await postChart(config);
        await assertPngResponse(res);
      });
    });
  });

  describe('output formats', () => {
    it('renders svg', async () => {
      const res = await postChart(BASIC_CONFIGS.bar, { format: 'svg' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('content-type'), 'image/svg+xml');
      assert.strictEqual(res.headers.get('x-quickchart-error'), null);
      const body = await res.text();
      assert(
        body.startsWith('<?xml') || body.startsWith('<svg'),
        'expected svg output to start with <?xml or <svg',
      );
    });

    it('renders pdf', async () => {
      const res = await postChart(BASIC_CONFIGS.bar, { format: 'pdf' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
      const buf = Buffer.from(await res.arrayBuffer());
      assert.strictEqual(buf.subarray(0, 4).toString('latin1'), '%PDF');
    });

    it('honors width, height, and devicePixelRatio', async () => {
      const res = await postChart(BASIC_CONFIGS.bar, {
        width: 240,
        height: 120,
        devicePixelRatio: 1,
      });
      const buf = await assertPngResponse(res);
      // PNG stores width/height as big-endian uint32 at offsets 16/20.
      assert.strictEqual(buf.readUInt32BE(16), 240);
      assert.strictEqual(buf.readUInt32BE(20), 120);
    });
  });

  describe('error handling', () => {
    it('returns 400 and an error image for an invalid config', async () => {
      const res = await fetch(`${baseUrl}/chart`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chart: 'this is not a chart config {{{' }),
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.headers.get('content-type'), 'image/png');
      assert(res.headers.get('x-quickchart-error').includes('Invalid input'));
      const buf = Buffer.from(await res.arrayBuffer());
      assert(buf.subarray(0, 8).equals(PNG_MAGIC), 'error responses render as PNG');
    });

    it('returns 400 when the chart is missing', async () => {
      const res = await fetch(`${baseUrl}/chart`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.strictEqual(res.status, 400);
      assert(res.headers.get('x-quickchart-error').includes('missing variable'));
    });

    it('marks the version parameter as deprecated', async () => {
      const res = await postChart(BASIC_CONFIGS.bar, { version: '2' });
      await assertPngResponse(res);
      assert(res.headers.get('x-quickchart-deprecation').includes('deprecated'));
    });

    it('does not serve POST /telemetry', async () => {
      const res = await fetch(`${baseUrl}/telemetry`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chartCount: 1, pid: 'abc' }),
      });
      assert.strictEqual(res.status, 404);
    });
  });

  describe('qr endpoint', () => {
    it('renders a qr code', async () => {
      const res = await fetch(`${baseUrl}/qr?text=${encodeURIComponent('hello e2e')}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('content-type'), 'image/png');
      const buf = Buffer.from(await res.arrayBuffer());
      assert(buf.subarray(0, 8).equals(PNG_MAGIC));
    });
  });
});
