import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobSource, JobStatus } from "@prisma/client";
import app from "../../src/app.js";
import prisma from "../../src/prisma/client.js";

const hasDb = Boolean(process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const createdOrganizationIds: string[] = [];
const createdJobIds: string[] = [];

async function cleanup() {
  if (createdJobIds.length > 0) {
    await prisma.job
      .deleteMany({ where: { id: { in: createdJobIds } } })
      .catch(() => {});
    createdJobIds.length = 0;
  }
  if (createdOrganizationIds.length > 0) {
    await prisma.organization
      .deleteMany({ where: { id: { in: createdOrganizationIds } } })
      .catch(() => {});
    createdOrganizationIds.length = 0;
  }
}

suite("Micro1 → ingest → ATS; publish → careers", () => {
  const previousSyncKey = process.env.SYNC_API_KEY;
  let orgId: string;
  let server: ReturnType<typeof app.listen>;
  let baseUrl: string;
  let micro1ExternalId: string;
  let atsExternalId: string;
  let closedAtsExternalId: string;
  const stamp = Date.now();

  beforeAll(async () => {
    process.env.SYNC_API_KEY = previousSyncKey || "test-sync-key";

    const org = await prisma.organization.create({
      data: { name: `Pipeline contract org ${stamp}`, type: "COMPANY" },
    });
    orgId = org.id;
    createdOrganizationIds.push(orgId);

    micro1ExternalId = `pipe-micro1-${stamp}`;
    atsExternalId = `pipe-ats-${stamp}`;
    closedAtsExternalId = `pipe-ats-closed-${stamp}`;

    const micro1 = await prisma.job.create({
      data: {
        externalId: micro1ExternalId,
        source: JobSource.MICRO1,
        title: `Pipe Micro1 Role ${stamp}`,
        organization: { connect: { id: orgId } },
        status: JobStatus.ACTIVE,
        applyUrl: "https://jobs.micro1.ai/post/example",
        metadata: { origin: "micro1" },
      },
    });
    createdJobIds.push(micro1.id);

    const ats = await prisma.job.create({
      data: {
        externalId: atsExternalId,
        source: JobSource.MANUAL,
        title: `Pipe ATS Published ${stamp}`,
        organization: { connect: { id: orgId } },
        status: JobStatus.ACTIVE,
        applyUrl: "https://headsbaseinc.com/jobs/example",
        metadata: { origin: "ats", integration: "HTN_ATS" },
      },
    });
    createdJobIds.push(ats.id);

    const closedAts = await prisma.job.create({
      data: {
        externalId: closedAtsExternalId,
        source: JobSource.MANUAL,
        title: `Pipe ATS Closed ${stamp}`,
        organization: { connect: { id: orgId } },
        status: JobStatus.CLOSED,
        applyUrl: "https://headsbaseinc.com/jobs/closed",
        metadata: { origin: "ats", integration: "HTN_ATS" },
      },
    });
    createdJobIds.push(closedAts.id);

    server = app.listen(0);
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      throw new Error("Failed to bind test server");
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    if (previousSyncKey === undefined) {
      delete process.env.SYNC_API_KEY;
    } else {
      process.env.SYNC_API_KEY = previousSyncKey;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await cleanup();
    await prisma.$disconnect();
  });

  it("GET /api/jobs is ATS-published ACTIVE only (headsbaseinc.com)", async () => {
    const atsRes = await fetch(
      `${baseUrl}/api/jobs?search=${encodeURIComponent(`Pipe ATS Published ${stamp}`)}&limit=50`,
    );
    const microRes = await fetch(
      `${baseUrl}/api/jobs?search=${encodeURIComponent(`Pipe Micro1 Role ${stamp}`)}&limit=50`,
    );
    const closedRes = await fetch(
      `${baseUrl}/api/jobs?search=${encodeURIComponent(`Pipe ATS Closed ${stamp}`)}&limit=50`,
    );

    expect(atsRes.status).toBe(200);
    const atsBody = await atsRes.json();
    const microBody = await microRes.json();
    const closedBody = await closedRes.json();

    const atsIds = atsBody.data.map((j: { jobId: string }) => j.jobId);
    const microIds = microBody.data.map((j: { jobId: string }) => j.jobId);
    const closedIds = closedBody.data.map((j: { jobId: string }) => j.jobId);

    expect(atsIds).toContain(atsExternalId);
    expect(microIds).not.toContain(micro1ExternalId);
    expect(closedIds).not.toContain(closedAtsExternalId);
  });

  it("GET /api/ingest/jobs is Micro1-only (excludes ATS-published)", async () => {
    const unauthorized = await fetch(
      `${baseUrl}/api/ingest/jobs?search=${encodeURIComponent(`Pipe Micro1 Role ${stamp}`)}&limit=50`,
    );
    expect(unauthorized.status).toBe(401);

    const microAuth = await fetch(
      `${baseUrl}/api/ingest/jobs?search=${encodeURIComponent(`Pipe Micro1 Role ${stamp}`)}&limit=50`,
      { headers: { "x-sync-key": process.env.SYNC_API_KEY! } },
    );
    expect(microAuth.status).toBe(200);
    const microBody = await microAuth.json();
    const microIds = microBody.data.map((j: { jobId: string }) => j.jobId);
    expect(microIds).toContain(micro1ExternalId);

    const atsInIngest = await fetch(
      `${baseUrl}/api/ingest/jobs?search=${encodeURIComponent(`Pipe ATS Published ${stamp}`)}&limit=50`,
      { headers: { "x-sync-key": process.env.SYNC_API_KEY! } },
    );
    const atsBody = await atsInIngest.json();
    const atsIds = atsBody.data.map((j: { jobId: string }) => j.jobId);
    expect(atsIds).not.toContain(atsExternalId);
    expect(atsIds).not.toContain(closedAtsExternalId);
  });
});
