QuickChart
---

[QuickChart](https://quickchart.io/) is a service that generates images of charts from a URL.  Because these charts are simple images, they are very easy to embed in non-dynamic environments such as email, SMS, chat rooms, and so on.

> **Note:** This fork is modernized to run on a single, current [Chart.js 4](https://www.chartjs.org/) with the full suite of [sgratzl chart.js plugins](https://github.com/sgratzl). It intentionally drops legacy Chart.js 2/3 rendering, the Google Image Charts compatibility endpoints, and Graphviz. See [Differences from upstream](#differences-from-upstream).

## See it in action

The chart image generation service is available online at [QuickChart.io](https://quickchart.io/).  There is an interactive editor that allows you to adjust inputs and build images.

A chart is defined completely by its URL or by the JSON body of a `POST /chart` request:

```js
{
  type: 'bar',
  data: {
    labels: ['January', 'February', 'March', 'April', 'May'],
    datasets: [{
      label: 'Dogs',
      data: [ 50, 60, 70, 180, 190 ]
    }, {
      label: 'Cats',
      data: [ 100, 200, 300, 400, 500 ]
    }]
  }
}
```

**Go to the full [QuickChart documentation](https://quickchart.io/documentation) to learn more.  See [gallery](https://quickchart.io/gallery/) for examples.**

## API

`GET /chart` and `POST /chart` accept the following parameters (query parameters for GET, JSON or form body fields for POST):

| Parameter | Alias | Description |
|---|---|---|
| `chart` | `c` | Chart.js 4 config, as JSON or a Javascript object literal (required) |
| `width` | `w` | Image width in logical pixels (default 500) |
| `height` | `h` | Image height in logical pixels (default 300) |
| `backgroundColor` | `bkg` | Canvas background color (default transparent) |
| `devicePixelRatio` | | Pixel density multiplier, output is `width*ratio` x `height*ratio` (default 2) |
| `format` | `f` | `png` (default), `svg`, or `pdf` |
| `encoding` | | `url` (default) or `base64` for the `chart` parameter |
| `version` | `v` | **Deprecated.** Accepted for backwards compatibility but ignored; charts always render with the bundled Chart.js 4.  Requests using it receive an `X-quickchart-deprecation` response header |

Invalid requests (missing or malformed chart config, out-of-range sizes, unknown chart types, unsupported formats) return HTTP **400**; unexpected server failures return HTTP **500**.  In both cases the error message is rendered as an image (so broken embeds show the reason) and echoed in the `X-quickchart-error` response header.

## Configuring your chart

The chart configuration object is based on the popular Chart.js API.  Check out the [Chart.js documentation](https://www.chartjs.org/docs/latest/) for more information on how to customize your chart, or see [QuickChart documentation](https://quickchart.io/documentation#parameters) for API options.

**Configs must use Chart.js 4 syntax** (`options.scales.x`/`options.scales.y`, `options.plugins.legend`, `options.plugins.title`, and so on). Chart.js 2-style configs (`scales.xAxes`, top-level `legend`, `type: 'horizontalBar'`) are not translated.

### Included chart plugins

The following plugins are registered and ready to use:

| Package | Chart types / features |
|---|---|
| [chartjs-plugin-annotation](https://github.com/chartjs/chartjs-plugin-annotation) | Line, box, ellipse, point, and label annotations via `options.plugins.annotation` |
| [chartjs-plugin-datalabels](https://github.com/chartjs/chartjs-plugin-datalabels) | Data labels via `options.plugins.datalabels` (shown by default for pie/doughnut) |
| [@sgratzl/chartjs-chart-boxplot](https://github.com/sgratzl/chartjs-chart-boxplot) | `boxplot`, `violin` |
| [chartjs-chart-error-bars](https://github.com/sgratzl/chartjs-chart-error-bars) | `barWithErrorBars`, `lineWithErrorBars`, `scatterWithErrorBars`, `polarAreaWithErrorBars` |
| [chartjs-chart-funnel](https://github.com/sgratzl/chartjs-chart-funnel) | `funnel` |
| [chartjs-chart-geo](https://github.com/sgratzl/chartjs-chart-geo) | `choropleth`, `bubbleMap` (a `topojson` helper is available in JS configs) |
| [chartjs-chart-graph](https://github.com/sgratzl/chartjs-chart-graph) | `graph`, `forceDirectedGraph`, `dendrogram`, `tree` |
| [chartjs-chart-pcp](https://github.com/sgratzl/chartjs-chart-pcp) | `pcp`, `logarithmicPcp` (parallel coordinates) |
| [chartjs-chart-venn](https://github.com/sgratzl/chartjs-chart-venn) | `venn`, `euler` |
| [chartjs-chart-wordcloud](https://github.com/sgratzl/chartjs-chart-wordcloud) | `wordCloud` |
| [chartjs-plugin-hierarchical](https://github.com/sgratzl/chartjs-plugin-hierarchical) | `hierarchical` scale type for expandable category axes |
| [chartjs-adapter-moment](https://github.com/chartjs/chartjs-adapter-moment) | `time` scales with moment.js format strings |

QuickChart custom types also work: `sparkline`, `progressBar`, and the `donut` alias.  `horizontalBoxplot`/`horizontalViolin` map to their vertical counterparts with `indexAxis: 'y'`.  Default dataset colors come from the built-in Chart.js [Colors plugin](https://www.chartjs.org/docs/latest/general/colors.html).

Note on server-side rendering: charts render exactly once (no animation loop), so `forceDirectedGraph` layouts run a fixed number of simulation iterations and are approximate.

## QR Codes

The service also produces QR codes.  For example, https://quickchart.io/qr?text=Hello+world produces:

![https://quickchart.io/qr?text=Hello+world](https://quickchart.io/qr?text=Hello+world)

The `/qr` endpoint has the following query parameters:
  - `text` - QR code data (required)
  - `format` - png or svg (png default)
  - `size` - size in pixels of one side of the square image (defaults to 150)
  - `margin` - size of the QR image margin in modules (defaults to 4)
  - `ecLevel` - Error correction level (defaults to M)
  - `dark` - Hex color code for dark portion of QR code (defaults to `000000`)
  - `light` - Hex color code for light portion of QR code (defauls to `ffffff`)

## Client libraries

  - [quickchart-js](https://github.com/typpo/quickchart-js) - Javascript
  - [quickchart-python](https://github.com/typpo/quickchart-python) - Python
  - [quickchart-ruby](https://github.com/typpo/quickchart-ruby) - Ruby
  - [quickchart-php](https://github.com/typpo/quickchart-php) - PHP
  - [quickchart-csharp](https://github.com/typpo/quickchart-csharp) - C#
  - [quickchart-java](https://github.com/typpo/quickchart-java) - Java
  - [chartjs-to-image](https://www.npmjs.com/package/chartjs-to-image) - Javascript package for Chart.js images

## Dependencies and Installation

Requires Node.js >= 20.9.

Chart generation uses [node-canvas](https://github.com/Automattic/node-canvas).  Prebuilt binaries cover most platforms (Windows, macOS, glibc Linux); on Alpine/musl it compiles from source and needs Cairo, Pango, libjpeg, giflib, librsvg, and pixman development headers (see the `Dockerfile` for the exact package list).

Install node dependencies with:

```
npm install
```

## Running the server

`npm start` (or `node index.js`) starts the server on port 3400.  Set your `PORT` environment variable to change this port.

Other environment variables: `CHART_MAX_WIDTH`/`CHART_MAX_HEIGHT` (default 3000), `RATE_LIMIT_PER_MIN` (enables rate limiting on `/chart` when set), `REQUEST_TIMEOUT_MS` (default 5000), `EXPRESS_JSON_LIMIT` (default 100kb), `LOG_LEVEL`, `ENABLE_TELEMETRY` (usage telemetry is **disabled** unless this is set).

## Testing

- `npm test` runs the fast test suite (in-process rendering + HTTP tests via supertest), including a render test for every supported chart type.
- `npm run test:e2e` runs end-to-end tests with [testcontainers](https://node.testcontainers.org/): it builds the Docker image, starts a container, sends `POST /chart` requests for every basic and plugin chart type, verifies the responses, and tears the container down.  Requires a running Docker daemon.  If the testcontainers reaper fails to start on your setup, run with `TESTCONTAINERS_RYUK_DISABLED=true`.

## Docker

Tagged releases (`vX.Y.Z`) are automatically built and published as multi-arch (amd64 + arm64) images to GitHub Container Registry as `ghcr.io/<owner>/quickchart:<version>` and `:latest` (see `.github/workflows/release.yml`).  Pull requests run the full test suite, including the Docker E2E tests (`.github/workflows/ci.yml`).

#### Building

`Dockerfile` sets up a server that provides chart and qr code web endpoints.

```
docker build -t quickchart .
```

#### Running

The server runs on port 3400 within the container.  This command will expose the server on port 8080 on your host (hostport:containerport):

```
docker run -p 8080:3400 quickchart
```

## Deploy

By following the **Docker** instructions above, you can deploy the service to any platform that supports running containers.

## Securing your self-hosted instance

This server assumes all Javascript sent in the config object is friendly.  If you are hosting QuickChart yourself, take care not to expose the service to untrusted parties.  Because Chart.js configs may contain arbitrary Javascript, it is necessary to properly sandbox your QuickChart instance if you are exposing it to the outside world.

## Health and Monitoring

QuickChart has two API endpoints to determine the health of the service.

`/healthcheck` is a basic endpoint that returns a 200 status code and a JSON object that looks like this: `{"success":true,"version":"2.0.0"}`.

A second endpoint, `/healthcheck/chart` returns a 302 status code and redirects to a chart with random attributes.  Although it is a more expensive endpoint, it can be useful for cache busting or testing chart rendering.

## Differences from upstream

This fork diverges from [typpo/quickchart](https://github.com/typpo/quickchart):

- **Chart.js 4 only.** The `version` parameter is accepted but ignored.  Chart.js 2-era plugins with no maintained successor were removed: `chartjs-plugin-piechart-outlabels`, `chartjs-plugin-doughnutlabel`, `chartjs-plugin-colorschemes` (the built-in Colors plugin provides default palettes), and `chartjs-chart-radial-gauge`.  The chart types `radialGauge`, `outlabeledPie`, and `outlabeledDoughnut` are no longer available.
- **All sgratzl chart.js plugins added** (boxplot/violin, error bars, funnel, geo, graph, pcp, venn, wordcloud, hierarchical).
- **Google Image Charts compatibility removed** (`/gchart` and `cht=` parameters).
- **Graphviz rendering removed.**
- **Client errors return 400** (upstream returns 500 for everything); `X-quickchart-error` is always populated on failures.
- **Telemetry is opt-in** (`ENABLE_TELEMETRY`); the `POST /telemetry` aggregation endpoint is removed.
- Express 5, pino logging, node-canvas 3, npm instead of yarn, Node 26 Docker base image, and a Docker-based E2E test suite.

## License

QuickChart is open source, licensed under version 3 of the GNU AGPL.  If you would like to modify this project for commercial purposes (and not release the source code), please [contact me](https://www.ianww.com/).
