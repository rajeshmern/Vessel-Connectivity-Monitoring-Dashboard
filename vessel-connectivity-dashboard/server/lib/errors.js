const DEFAULT_CODES = {
  400: 'bad_request',
  404: 'not_found',
  409: 'conflict',
  422: 'validation_failed',
};

export class HttpError extends Error {
  constructor(status, message, { code, fields } = {}) {
    super(message);
    this.status = status;
    this.code = code ?? DEFAULT_CODES[status] ?? 'error';
    this.fields = fields;
  }
}

export const badRequest = (message) => new HttpError(400, message);
export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);
export const conflict = (message, fields) => new HttpError(409, message, { fields });
export const invalid = (fields) => new HttpError(422, 'Some fields need attention', { fields });

// Last middleware in the chain. Anything not an HttpError is a bug on our side,
// so log it and keep the details out of the response.
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.fields && { fields: err.fields }) },
    });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'bad_request', message: 'Request body is not valid JSON' } });
  }
  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong on the server' } });
}
