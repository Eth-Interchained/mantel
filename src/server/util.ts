import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 does not catch async route errors — an engine hiccup would
 * otherwise become an unhandled rejection and kill the process. Every
 * async route goes through wrap() so failures become 500s, not crashes.
 */
export function wrap(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch((err) => {
      console.error(
        `\x1b[31m[links]\x1b[0m ${req.method} ${req.originalUrl}: ${err instanceof Error ? err.message : err}`,
      );
      if (!res.headersSent) {
        res.status(502).json({ error: "engine unavailable" });
      }
    });
  };
}
