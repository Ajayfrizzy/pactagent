import type { NextFunction, Request, Response } from 'express';

export function payloadLimit(maxBytes: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
    const declared = Number(req.header('content-length') || 0);
    const actual = req.body === undefined ? 0 : Buffer.byteLength(JSON.stringify(req.body));
    if ((Number.isFinite(declared) && declared > maxBytes) || actual > maxBytes) {
      return res.status(413).json({
        error: {
          type: 'invalid_request_error',
          code: 'payload_too_large',
          message: `Request payload exceeds the ${maxBytes}-byte endpoint limit.`,
          requestId: req.requestId,
        },
      });
    }
    return next();
  };
}
