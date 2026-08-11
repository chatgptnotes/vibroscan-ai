export function notFound(_req, res) {
  res.status(404).json({ success: false, error: 'Not found.' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  console.error('[error]', err.message);

  // Multer payload / size errors
  let status = err.status || 500;
  if (err.code === 'LIMIT_FILE_SIZE') status = 413;

  res.status(status).json({
    success: false,
    error: err.publicMessage || err.message || 'Internal server error.',
  });
}
