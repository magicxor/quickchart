const { logger } = require('./logging');

const PROCESS_ID = Math.floor(Math.random() * 1e10).toString(16);

let telemetry = {};

function count(label) {
  if (!telemetry[label]) {
    telemetry[label] = 0;
  }
  telemetry[label] += 1;
}

function send() {
  if (!telemetry.chartCount && !telemetry.qrCount) {
    return;
  }
  const data = {
    pid: PROCESS_ID,
    chartCount: telemetry.chartCount,
    qrCount: telemetry.qrCount,
  };
  // Fire-and-forget; swallow async rejections (a try/catch would not catch them).
  fetch('https://quickchart.io/telemetry', {
    method: 'POST',
    body: JSON.stringify(data),
    headers: {
      'content-type': 'application/json',
    },
  }).catch(() => {});

  telemetry = {};
}

// Telemetry is opt-in: nothing is sent unless ENABLE_TELEMETRY is set.
if (process.env.ENABLE_TELEMETRY) {
  logger.info('Telemetry is enabled');
  setInterval(
    () => {
      send();
    },
    1000 * 60 * 60 * 12,
  );
}

module.exports = {
  count,
};
