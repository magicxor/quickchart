const path = require('path');

const express = require('express');
const qs = require('qs');
const { rateLimit } = require('express-rate-limit');

const packageJson = require('./package.json');
const telemetry = require('./telemetry');
const { getPdfBufferFromPng, getPdfBufferWithText } = require('./lib/pdf');
const { logger } = require('./logging');
const { renderChartJs } = require('./lib/charts');
const { listMaps, describeMap } = require('./lib/maps');
const { renderQr, DEFAULT_QR_SIZE } = require('./lib/qr');
const { renderTextToPng } = require('./lib/text');

const app = express();

const isDev = app.get('env') === 'development' || app.get('env') === 'test';

// Trust reverse-proxy headers (X-Forwarded-For et al.) only when explicitly
// configured; otherwise a direct client could spoof its IP, e.g. to bypass
// rate limiting. Accepts the standard Express values: 'true'/'false', a hop
// count, or a comma-separated IP/CIDR list.
if (process.env.TRUST_PROXY) {
  const raw = process.env.TRUST_PROXY.trim();
  let trustProxy;
  if (raw === 'true') {
    trustProxy = true;
  } else if (raw === 'false') {
    trustProxy = false;
  } else if (/^\d+$/.test(raw)) {
    trustProxy = parseInt(raw, 10);
  } else {
    trustProxy = raw.split(',').map((entry) => entry.trim());
  }
  app.set('trust proxy', trustProxy);
  logger.info('Trusting proxy:', raw);
}

app.set('query parser', (str) =>
  qs.parse(str, {
    decode(s) {
      // Default express implementation replaces '+' with space. We don't want
      // that. See https://github.com/expressjs/express/issues/3453
      return decodeURIComponent(s);
    },
  }),
);

app.use(
  express.json({
    limit: process.env.EXPRESS_JSON_LIMIT || '100kb',
  }),
);

app.use(express.urlencoded({ extended: true }));

if (process.env.RATE_LIMIT_PER_MIN) {
  const limitMax = parseInt(process.env.RATE_LIMIT_PER_MIN, 10);
  logger.info('Enabling rate limit:', limitMax);

  // The default key generator uses req.ip (which honors the `trust proxy`
  // setting above) and masks IPv6 addresses to a subnet. Reading
  // X-Forwarded-For directly would let clients spoof their identity.
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    limit: limitMax,
    message:
      'Please slow down your requests! This is a shared public endpoint. Email support@quickchart.io or go to https://quickchart.io/pricing/ for rate limit exceptions or to purchase a commercial license.',
    handler: (req, res, next, options) => {
      logger.info('User hit rate limit!', req.ip);
      res.status(options.statusCode).send(options.message);
    },
  });
  app.use('/chart', limiter);
}

app.get('/', (req, res) => {
  res.send(
    'QuickChart is running!<br><br>If you are using QuickChart commercially, please consider <a href="https://quickchart.io/pricing/">purchasing a license</a> to support the project.',
  );
});

function utf8ToAscii(str) {
  const enc = new TextEncoder();
  const u8s = enc.encode(str);

  return Array.from(u8s)
    .map((v) => String.fromCharCode(v))
    .join('');
}

function sanitizeErrorHeader(msg) {
  if (typeof msg === 'string') {
    return utf8ToAscii(msg).replace(/\r?\n|\r/g, '');
  }
  return '';
}

// Error messages can embed user-supplied input (configs, QR data). Truncate at
// the source so response headers stay within header-size limits and SVG/PDF
// error bodies stay small; the PNG renderer additionally clamps its canvas.
const MAX_ERROR_TEXT_LENGTH = 1000;

function errorText(msg) {
  const text = msg instanceof Error ? msg.message : String(msg);
  return text.length > MAX_ERROR_TEXT_LENGTH ? `${text.slice(0, MAX_ERROR_TEXT_LENGTH)}...` : text;
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function failPng(res, msg, statusCode = 500) {
  const text = errorText(msg);
  res.writeHead(statusCode, {
    'Content-Type': 'image/png',
    'X-quickchart-error': sanitizeErrorHeader(text),
  });
  res.end(
    renderTextToPng(`Chart Error: ${text}`, {
      padding: 10,
      backgroundColor: '#fff',
    }),
  );
}

function failSvg(res, msg, statusCode = 500) {
  const text = errorText(msg);
  res.writeHead(statusCode, {
    'Content-Type': 'image/svg+xml',
    'X-quickchart-error': sanitizeErrorHeader(text),
  });
  res.end(`
<svg viewBox="0 0 240 80" xmlns="http://www.w3.org/2000/svg">
  <style>
    p {
      font-size: 8px;
    }
  </style>
  <foreignObject width="240" height="80"
   requiredFeatures="http://www.w3.org/TR/SVG11/feature#Extensibility">
    <p xmlns="http://www.w3.org/1999/xhtml">${escapeXml(text)}</p>
  </foreignObject>
</svg>`);
}

async function failPdf(res, msg, statusCode = 500) {
  const text = errorText(msg);
  const buf = await getPdfBufferWithText(text);
  res.writeHead(statusCode, {
    'Content-Type': 'application/pdf',
    'X-quickchart-error': sanitizeErrorHeader(text),
  });
  res.end(buf);
}

function renderChartToPng(req, res, opts) {
  opts.failFn = failPng;
  opts.onRenderHandler = (buf) => {
    res
      .type('image/png')
      .set({
        // 1 week cache
        'Cache-Control': isDev ? 'no-cache' : 'public, max-age=604800',
      })
      .send(buf);
  };
  doChartjsRender(req, res, opts);
}

function renderChartToSvg(req, res, opts) {
  opts.failFn = failSvg;
  opts.onRenderHandler = (buf) => {
    res
      .type('image/svg+xml')
      .set({
        // 1 week cache
        'Cache-Control': isDev ? 'no-cache' : 'public, max-age=604800',
      })
      .send(buf);
  };
  doChartjsRender(req, res, opts);
}

async function renderChartToPdf(req, res, opts) {
  opts.failFn = failPdf;
  opts.onRenderHandler = async (buf) => {
    const pdfBuf = await getPdfBufferFromPng(buf);

    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuf.length,

      // 1 week cache
      'Cache-Control': isDev ? 'no-cache' : 'public, max-age=604800',
    });
    res.end(pdfBuf);
  };
  doChartjsRender(req, res, opts);
}

// An omitted dimension stays omitted: the renderer sizes the canvas from what
// the chart is (see lib/canvas.js), which it can do better than a fixed default
// ever could.
function parseSizeParam(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  // Number() rather than parseInt(): partially-numeric input like '500px'
  // must reach the renderer as NaN and be rejected as a 400, not silently
  // truncated to 500.
  return Number(value);
}

function doChartjsRender(req, res, opts) {
  if (opts.version) {
    res.set(
      'X-quickchart-deprecation',
      'The version parameter is deprecated and ignored; charts always render with Chart.js 4',
    );
  }

  if (!opts.chart) {
    opts.failFn(res, 'You are missing variable `c` or `chart`', 400);
    return;
  }

  // Absent dimensions are derived by the renderer; present-but-invalid values
  // are passed through so it rejects them as 400 input errors (instead of
  // silently defaulting or leaking into canvas code as a 500).
  const width = parseSizeParam(opts.width);
  const height = parseSizeParam(opts.height);

  let untrustedInput = opts.chart;
  if (opts.encoding === 'base64') {
    // TODO(ian): Move this decoding up the call stack.
    try {
      untrustedInput = Buffer.from(opts.chart, 'base64').toString('utf8');
    } catch (err) {
      logger.warn('base64 malformed', err);
      opts.failFn(res, err, 400);
      return;
    }
  }

  renderChartJs(
    width,
    height,
    opts.backgroundColor,
    opts.devicePixelRatio,
    opts.version,
    opts.format,
    untrustedInput,
  )
    .then(opts.onRenderHandler)
    .catch((err) => {
      logger.warn('Chart error', err);
      opts.failFn(res, err, err && err.statusCode ? err.statusCode : 500);
    });
}

app.get('/chart', (req, res) => {
  const outputFormat = (req.query.f || req.query.format || 'png').toLowerCase();
  const opts = {
    chart: req.query.c || req.query.chart,
    height: req.query.h || req.query.height,
    width: req.query.w || req.query.width,
    backgroundColor: req.query.backgroundColor || req.query.bkg,
    devicePixelRatio: req.query.devicePixelRatio,
    version: req.query.v || req.query.version,
    encoding: req.query.encoding || 'url',
    format: outputFormat,
  };

  if (outputFormat === 'pdf') {
    renderChartToPdf(req, res, opts);
  } else if (outputFormat === 'svg') {
    renderChartToSvg(req, res, opts);
  } else if (!outputFormat || outputFormat === 'png') {
    renderChartToPng(req, res, opts);
  } else {
    logger.error(`Request for unsupported format ${outputFormat}`);
    failPng(res, `Unsupported format ${outputFormat}`, 400);
  }

  telemetry.count('chartCount');
});

app.post('/chart', (req, res) => {
  const outputFormat = (req.body.f || req.body.format || 'png').toLowerCase();
  const opts = {
    chart: req.body.c || req.body.chart,
    height: req.body.h || req.body.height,
    width: req.body.w || req.body.width,
    backgroundColor: req.body.backgroundColor || req.body.bkg,
    devicePixelRatio: req.body.devicePixelRatio,
    version: req.body.v || req.body.version,
    encoding: req.body.encoding || 'url',
    format: outputFormat,
  };

  if (outputFormat === 'pdf') {
    renderChartToPdf(req, res, opts);
  } else if (outputFormat === 'svg') {
    renderChartToSvg(req, res, opts);
  } else {
    renderChartToPng(req, res, opts);
  }

  telemetry.count('chartCount');
});

app.get('/qr', (req, res) => {
  const qrText = req.query.text;
  if (!qrText) {
    failPng(res, 'You are missing variable `text`', 400);
    return;
  }

  let format = 'png';
  if (req.query.format === 'svg') {
    format = 'svg';
  }

  const { mode } = req.query;

  const margin = typeof req.query.margin === 'undefined' ? 4 : parseInt(req.query.margin, 10);
  const ecLevel = req.query.ecLevel || undefined;
  const size = Math.min(3000, parseInt(req.query.size, 10)) || DEFAULT_QR_SIZE;
  const darkColor = req.query.dark || '000';
  const lightColor = req.query.light || 'fff';

  const qrOpts = {
    margin,
    width: size,
    errorCorrectionLevel: ecLevel,
    color: {
      dark: darkColor,
      light: lightColor,
    },
  };

  renderQr(format, mode, qrText, qrOpts)
    .then((buf) => {
      res.writeHead(200, {
        'Content-Type': format === 'png' ? 'image/png' : 'image/svg+xml',
        'Content-Length': buf.length,

        // 1 week cache
        'Cache-Control': isDev ? 'no-cache' : 'public, max-age=604800',
      });
      res.end(buf);
    })
    .catch((err) => {
      // QR failures are input-driven (data too long, bad params).
      failPng(res, err, 400);
    });

  telemetry.count('qrCount');
});

app.get('/maps', (req, res) => {
  // Discovery endpoint for built-in geo maps. Without parameters it lists all
  // map names; ?name=<map> additionally enumerates the features (name/id
  // pairs) that choropleth data rows can reference.
  if (req.query.name) {
    try {
      res.send(describeMap(String(req.query.name)));
    } catch (err) {
      const text = errorText(err);
      res
        .status(err && err.statusCode ? err.statusCode : 500)
        .set('X-quickchart-error', sanitizeErrorHeader(text))
        .send({ error: text });
    }
    return;
  }
  res.send(listMaps());
});

app.get('/healthcheck', (req, res) => {
  // A lightweight healthcheck endpoint.
  res.send({ success: true, version: packageJson.version });
});

app.get('/healthcheck/chart', (req, res) => {
  // A heavier healthcheck endpoint that redirects to a unique chart.
  const labels = [...Array(5)].map(() => Math.random());
  const data = [...Array(5)].map(() => Math.random());
  const template = `
{
  type: 'bar',
  data: {
    labels: [${labels.join(',')}],
    datasets: [{
      data: [${data.join(',')}]
    }]
  }
}
`;
  res.redirect(`/chart?c=${template}`);
});

const port = process.env.PORT || 3400;
const server = app.listen(port);

const timeout = parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || 5000;
server.setTimeout(timeout);
logger.info(`Setting request timeout: ${timeout} ms`);

logger.info(`NODE_ENV: ${process.env.NODE_ENV}`);
logger.info(`Listening on port ${port}`);

if (!isDev) {
  const gracefulShutdown = function gracefulShutdown() {
    logger.info('Received kill signal, shutting down gracefully.');
    server.close(() => {
      logger.info('Closed out remaining connections.');
      process.exit();
    });

    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down');
      process.exit();
    }, 10 * 1000);
  };

  // listen for TERM signal .e.g. kill
  process.on('SIGTERM', gracefulShutdown);

  // listen for INT signal e.g. Ctrl-C
  process.on('SIGINT', gracefulShutdown);

  process.on('SIGABRT', () => {
    logger.info('Caught SIGABRT');
  });
}

module.exports = app;
