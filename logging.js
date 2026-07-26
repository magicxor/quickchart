const pino = require('pino');

const baseLogger = pino({
  name: 'quickchart',
  level: process.env.LOG_LEVEL || 'info',
});

function formatArg(arg) {
  if (arg instanceof Error) {
    return arg.stack || arg.message;
  }
  if (typeof arg === 'object' && arg !== null) {
    try {
      return JSON.stringify(arg);
    } catch (err) {
      return String(arg);
    }
  }
  return String(arg);
}

// Callers use bunyan-style variadic args, e.g. logger.error('Input Error', err,
// chart). Raw pino would treat trailing args as unused interpolation params, so
// flatten everything into the message.
function wrap(level) {
  return (...args) => {
    const err = args.find((arg) => arg instanceof Error);
    const msg = args.map(formatArg).join(' ');
    if (err) {
      baseLogger[level]({ err }, msg);
    } else {
      baseLogger[level](msg);
    }
  };
}

const logger = {
  debug: wrap('debug'),
  info: wrap('info'),
  warn: wrap('warn'),
  error: wrap('error'),
};

module.exports = {
  logger,
};
