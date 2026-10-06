import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import ingestRouter from "../../src/routes/ingest.js";

vi.mock("../../src/services/referrals.service.js", () => ({
  getReferralCandidates: vi.fn(async () => ({
    candidates: [
      {
        id: "cand-1",
        externalId: "ref-1",
        name: "Cheryl Julian",
        email: null,
        dateOfReferral: "2026-09-24 14:50:19",
        status: "applying",
        expertWorkStatus: {
          label: "0 hours",
          hoursWorked: 0,
          hoursThreshold: 10,
          tasksCompleted: 0,
          requiredMinimumTasks: 1,
          projectType: null,
          isPpt: false,
          isHoursThresholdMet: false,
          percent: 0,
        },
        applicationCount: 1,
        payout: null,
        dateReferred: "2026-09-24 14:50:19",
        micro1Status: "applying",
      },
    ],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  })),
}));

vi.mock("../../src/services/jobs.service.js", () => ({
  getJobs: vi.fn(),
}));

async function withApp(
  handler: (app: express.Express) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/ingest", ingestRouter);
  await handler(app);
}

describe("GET /api/ingest/referrals", () => {
  const previousKey = process.env.SYNC_API_KEY;

  beforeEach(() => {
    process.env.SYNC_API_KEY = "secret-key";
  });

  afterEach(() => {
    if (previousKey === undefined) {
      delete process.env.SYNC_API_KEY;
    } else {
      process.env.SYNC_API_KEY = previousKey;
    }
  });

  it("requires sync API key", async () => {
    await withApp(async (app) => {
      const server = app.listen(0);
      try {
        const { port } = server.address() as { port: number };
        const response = await fetch(
          `http://127.0.0.1:${port}/api/ingest/referrals`,
        );
        expect(response.status).toBe(401);
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
      }
    });
  });

  it("returns referral candidates without rolesAppliedTo", async () => {
    await withApp(async (app) => {
      const server = app.listen(0);
      try {
        const { port } = server.address() as { port: number };
        const response = await fetch(
          `http://127.0.0.1:${port}/api/ingest/referrals?page=1&limit=20`,
          { headers: { "x-sync-key": "secret-key" } },
        );
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data).toHaveLength(1);
        expect(body.data[0].name).toBe("Cheryl Julian");
        expect(body.data[0].dateOfReferral).toBe("2026-09-24 14:50:19");
        expect(body.data[0].status).toBe("applying");
        expect(body.data[0].expertWorkStatus.label).toBe("0 hours");
        expect(body.data[0].applicationCount).toBe(1);
        expect(body.data[0].payout).toBeNull();
        expect(body.data[0].rolesAppliedTo).toBeUndefined();
        expect(body.data[0].applications).toBeUndefined();
        expect(body.pagination.total).toBe(1);
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
      }
    });
  });
});
