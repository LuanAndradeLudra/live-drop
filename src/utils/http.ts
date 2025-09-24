import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const r = schema.safeParse(req.body);
    if (!r.success) {
      return res.status(400).json({ error: 'invalid_body', details: r.error.flatten() });
    }
    (req as any).data = r.data;
    next();
  };
}

export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const r = schema.safeParse(req.query);
    if (!r.success) {
      return res.status(400).json({ error: 'invalid_query', details: r.error.flatten() });
    }
    (req as any).queryData = r.data;
    next();
  };
}
