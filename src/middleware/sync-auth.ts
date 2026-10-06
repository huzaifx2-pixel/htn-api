import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";

export function requireSyncApiKey(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const expected = process.env.SYNC_API_KEY?.trim();
  if (!expected) {
    next(
      new AppError(
        "SYNC_NOT_CONFIGURED",
        "SYNC_API_KEY is not configured on the server",
        503,
      ),
    );
    return;
  }

  const provided =
    (typeof req.headers["x-sync-key"] === "string"
      ? req.headers["x-sync-key"]
      : undefined) ??
    (typeof req.headers.authorization === "string" &&
    req.headers.authorization.startsWith("Bearer ")
      ? req.headers.authorization.slice("Bearer ".length)
      : undefined);

  if (!provided || provided !== expected) {
    next(new AppError("UNAUTHORIZED", "Invalid or missing sync API key", 401));
    return;
  }

  next();
}
