import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import syncMicro1Router from "../../src/routes/sync-micro1.js";
import { resetMicro1ClientForTests } from "../../src/services/micro1-sync.service.js";

vi.mock("../../src/services/micro1-referral-sync.service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/services/micro1-referral-sync.service.js")
  >("../../src/services/micro1-referral-sync.service.js");
  return {
    ...actual,
    runMicro1ReferralSync: vi.fn(async () => ({
      totalSeen: 2,
      totalCandidatesCreated: 1,
      totalCandidatesUpdated: 1,
      totalApplicationsCreated: 1,
      totalApplicationsUpdated: 0,
      totalSkippedMissingJob: 0,
      totalFailed: 0,
      syncStart: new Date("2026-09-24T12:00:00.000Z"),
      syncEnd: new Date("2026-09-24T12:01:00.000Z"),
    })),
  };
});

async function withApp(
  handler: (app: express.Express) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/sync/micro1", syncMicro1Router);
  await handler(app);
}

describe("POST /api/sync/micro1/referrals/run", () => {
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

  it("requires sync API key", async () => {
    process.env.SYNC_API_KEY = "secret-key";

    await withApp(async (app) => {
      const server = app.listen(0);
      try {
        const { port } = server.address() as { port: number };
        const response = await fetch(
          `http://127.0.0.1:${port}/api/sync/micro1/referrals/run`,
          { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
        );
        expect(response.status).toBe(401);
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
      }
    });
  });

  it("returns sync counts with a valid key", async () => {
    process.env.SYNC_API_KEY = "secret-key";

    await withApp(async (app) => {
      const server = app.listen(0);
      try {
        const { port } = server.address() as { port: number };
        const response = await fetch(
          `http://127.0.0.1:${port}/api/sync/micro1/referrals/run`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-sync-key": "secret-key",
            },
            body: JSON.stringify({ limit: 5 }),
          },
        );
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data.totalSeen).toBe(2);
        expect(body.data.totalCandidatesCreated).toBe(1);
        expect(body.data.totalApplicationsCreated).toBe(1);
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
      }
    });
  });
});
