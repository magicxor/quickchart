/**
 * Error caused by bad request input (invalid chart config, out-of-range
 * parameters, ...). Rendered endpoints translate `statusCode` into the HTTP
 * response status: 400 for input errors, 500 for everything else.
 */
class ChartInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ChartInputError';
    this.statusCode = 400;
  }
}

module.exports = {
  ChartInputError,
};
