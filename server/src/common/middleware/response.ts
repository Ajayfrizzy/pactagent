import type { Response } from 'express';

type Pagination = {
  limit: number;
  cursor: string | null;
};

export function sendSuccess(res: Response, data: unknown, statusCode = 200) {
  return res.status(statusCode).json({
    data,
    requestId: res.req.requestId,
  });
}

export function sendList(res: Response, data: unknown[], pagination: Pagination, statusCode = 200) {
  return res.status(statusCode).json({
    data,
    pagination,
    requestId: res.req.requestId,
  });
}
