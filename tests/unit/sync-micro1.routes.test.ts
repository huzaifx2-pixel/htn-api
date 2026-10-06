import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import syncMicro1Router from "../../src/routes/sync-micro1.js";
import { resetMicro1ClientForTests } from "../../src/services/micro1-sync.service.js";

async function withApp(
  handler: (app: express.Express) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/sync/micro1", syncMicro1Router);
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (res.headersSent) {
        next(error);
        return;
      }
      const err = error as { statusCode?: number; code?: string; message?: string };
      if (err?.statusCode) {
        res.status(err.statusCode).json({
          success: false,
          code: err.code,
          message: err.message,
        });
        return;
      }
      res.status(500).json({ success: false, message: "Internal server error" });
    },
  );
  await handler(app);
}

describe("sync micro1 API key guard", () => {
  const previousKey = process.env.SYNC_API_KEY;

  beforeEach(() => {
    resetMicro1ClientForTests();
  });

  afterEach(() => {
    if (previousKey === undefined) {
      delete process.env.SYNC_API_KEY;
    } else {
      process.env.SYNC_API_KEY = previousKey;
    }
    resetMicro1ClientForTests();
  });

  it("rejects requests without x-sync-key when SYNC_API_KEY is configured", async () => {
    process.env.SYNC_API_KEY = "secret-key";

    await withApp(async (app) => {
      const server = app.listen(0);
      try {
        const { port } = server.address() as { port: number };
        const response = await fetch(
          `http://127.0.0.1:${port}/api/sync/micro1/auth/status`,
        );
        const body = await response.json();
        expect(response.status).toBe(401);
        expect(body.success).toBe(false);
        expect(body.code).toBe("UNAUTHORIZED");
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
      }
    });
  });

  it("allows requests with a valid x-sync-key", async () => {
    process.env.SYNC_API_KEY = "secret-key";

    await withApp(async (app) => {
      const server = app.listen(0);
      try {
        const { port } = server.address() as { port: number };
        const response = await fetch(
          `http://127.0.0.1:${port}/api/sync/micro1/auth/status`,
          {
            headers: { "x-sync-key": "secret-key" },
          },
        );
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data).toHaveProperty("authenticated");
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
      }
    });
  });

  it("returns 503 when SYNC_API_KEY is not configured", async () => {
    delete process.env.SYNC_API_KEY;

    await withApp(async (app) => {
      const server = app.listen(0);
      try {
        const { port } = server.address() as { port: number };
        const response = await fetch(
          `http://127.0.0.1:${port}/api/sync/micro1/auth/status`,
          {
            headers: { "x-sync-key": "anything" },
          },
        );
        const body = await response.json();
        expect(response.status).toBe(503);
        expect(body.code).toBe("SYNC_NOT_CONFIGURED");
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
      }
    });
  });
});
