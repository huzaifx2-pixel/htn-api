import "dotenv/config";

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import {
  ApplicationSource,
  ApplicationStatus,
  CandidateStatus,
  JobSource,
  JobStatus,
} from "@prisma/client";
import prisma from "../../src/prisma/client.js";
import { getReferralCandidates } from "../../src/services/referrals.service.js";

const hasDb = Boolean(process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const createdOrganizationIds: string[] = [];
const createdJobIds: string[] = [];
const createdCandidateIds: string[] = [];
const createdApplicationIds: string[] = [];

async function cleanup() {
  if (createdApplicationIds.length > 0) {
    await prisma.application
      .deleteMany({ where: { id: { in: createdApplicationIds } } })
      .catch(() => {});
    createdApplicationIds.length = 0;
  }
  if (createdCandidateIds.length > 0) {
    await prisma.candidate
      .deleteMany({ where: { id: { in: createdCandidateIds } } })
      .catch(() => {});
    createdCandidateIds.length = 0;
  }
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

suite("Referrals ingest list", () => {
  let orgId: string;
  let jobId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Org for Referrals", type: "COMPANY" },
    });
    orgId = org.id;
    createdOrganizationIds.push(orgId);

    const job = await prisma.job.create({
      data: {
        externalId: `test-referral-job-${Date.now()}`,
        source: JobSource.MICRO1,
        title: "Referral Test Role",
        status: JobStatus.ACTIVE,
        organization: { connect: { id: orgId } },
        metadata: { origin: "micro1" },
      },
    });
    jobId = job.id;
    createdJobIds.push(jobId);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    if (createdApplicationIds.length > 0) {
      await prisma.application
        .deleteMany({ where: { id: { in: createdApplicationIds } } })
        .catch(() => {});
      createdApplicationIds.length = 0;
    }
    if (createdCandidateIds.length > 0) {
      await prisma.candidate
        .deleteMany({ where: { id: { in: createdCandidateIds } } })
        .catch(() => {});
      createdCandidateIds.length = 0;
    }
  });

  it("lists Micro1 referral candidates with nested applications", async () => {
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });

    const candidate = await prisma.candidate.create({
      data: {
        externalId: `test-ref-${Date.now()}`,
        firstName: "Cheryl",
        lastName: "Julian",
        status: CandidateStatus.ACTIVE,
        metadata: {
          origin: "micro1",
          status: "applying",
          micro1Status: "applying",
          dateOfReferral: "2026-09-24 14:50:19",
          dateReferred: "2026-09-24 14:50:19",
          applicationCount: 1,
          payout: null,
          payoutAmount: null,
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
          rolesAppliedTo: [
            {
              jobExternalId: job.externalId,
              jobTitle: "Virtual Assistant",
              company: "micro1",
              appliedOn: "2026-09-24 14:50:18",
              applyUrl: null,
            },
          ],
        },
      },
    });
    createdCandidateIds.push(candidate.id);

    const application = await prisma.application.create({
      data: {
        externalId: `${candidate.externalId}:${job.externalId}`,
        candidateId: candidate.id,
        jobId,
        source: ApplicationSource.REFERRAL,
        status: ApplicationStatus.APPLIED,
        submittedAt: new Date("2026-09-24T14:50:18.000Z"),
        metadata: {
          origin: "micro1",
          micro1Status: "applying",
          jobName: "Virtual Assistant",
          appliedOn: "2026-09-24 14:50:18",
        },
      },
    });
    createdApplicationIds.push(application.id);

    const result = await getReferralCandidates(1, 50);
    const match = result.candidates.find((c) => c.id === candidate.id);
    expect(match).toBeDefined();
    expect(match!.name).toBe("Cheryl Julian");
    expect(match!.dateOfReferral).toBe("2026-09-24 14:50:19");
    expect(match!.status).toBe("applying");
    expect(match!.expertWorkStatus?.label).toBe("0 hours");
    expect(match!.applicationCount).toBe(1);
    expect(match!.payout).toBeNull();
    expect((match as { rolesAppliedTo?: unknown }).rolesAppliedTo).toBeUndefined();
    expect((match as { applications?: unknown }).applications).toBeUndefined();
  });
});