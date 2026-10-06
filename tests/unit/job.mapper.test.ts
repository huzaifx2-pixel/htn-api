import { describe, it, expect } from "vitest";
import { JobSource, JobStatus, WorkplaceType } from "@prisma/client";
import {
  formatJobPay,
  mapPrismaJobToApiJob,
} from "../../src/mappers/job.mapper.js";
import type { JobWithRelations } from "../../src/repositories/job.repository.js";

function prismaJob(
  overrides: Partial<JobWithRelations> & {
    organization?: { name: string } | null;
    jobSkills?: { skill: { name: string } }[];
  } = {},
): JobWithRelations {
  return {
    id: "1",
    externalId: "job-1",
    source: JobSource.MICRO1,
    title: "Family Law Attorney",
    description: "Advise clients.",
    applyUrl:
      "https://jobs.micro1.ai/post/job-1?referralCode=452891ab-aef5",
    openings: 2,
    salaryMin: 40 as never,
    salaryMax: 60 as never,
    salaryCurrency: "USD",
    metadata: { payRatePeriod: "hourly" },
    organization: { name: "Acme Legal" } as never,
    jobSkills: [
      { skill: { name: "Legal writing" } },
      { skill: { name: "Litigation" } },
    ] as never,
    status: JobStatus.ACTIVE,
    workplaceType: WorkplaceType.REMOTE,
    ...overrides,
  } as JobWithRelations;
}

describe("formatJobPay", () => {
  it("formats hourly ranges", () => {
    expect(
      formatJobPay({
        salaryMin: 40,
        salaryMax: 60,
        salaryCurrency: "USD",
        metadata: { payRatePeriod: "hourly" },
      }),
    ).toBe("$40-$60/hr");
  });

  it("formats monthly ranges", () => {
    expect(
      formatJobPay({
        salaryMin: 5000,
        salaryMax: 7000,
        salaryCurrency: "USD",
        metadata: { payRatePeriod: "monthly" },
      }),
    ).toBe("$5,000-$7,000/mo");
  });

  it("returns empty string when unknown", () => {
    expect(formatJobPay({ salaryMin: null, salaryMax: null, metadata: {} })).toBe(
      "",
    );
  });
});

describe("mapPrismaJobToApiJob", () => {
  it("returns the 7 import fields plus compatibility aliases", () => {
    const api = mapPrismaJobToApiJob(prismaJob());

    expect(api).toMatchObject({
      jobId: "job-1",
      client: "Acme Legal",
      company: "Acme Legal",
      title: "Family Law Attorney",
      description: "Advise clients.",
      openings: 2,
      skills: ["Legal writing", "Litigation"],
      pay: "$40-$60/hr",
      referralLink:
        "https://jobs.micro1.ai/post/job-1?referralCode=452891ab-aef5",
      applyUrl:
        "https://jobs.micro1.ai/post/job-1?referralCode=452891ab-aef5",
      locationType: "Remote",
      requirements: "",
      responsibilities: "",
      source: "micro1",
    });
  });

  it("parses ATS JSON requirements into readable text and skills", () => {
    const api = mapPrismaJobToApiJob(
      prismaJob({
        jobSkills: [],
        requirements: JSON.stringify({
          requiredSkills: ["Attention to detail", "Smartphone Video Recording"],
          skills: [],
          preferredSkills: [],
        }),
      }),
    );

    expect(api.requirements).toContain("Attention to detail");
    expect(api.skills).toEqual(
      expect.arrayContaining(["Attention to detail", "Smartphone Video Recording"]),
    );
    expect(api.requirements).not.toMatch(/^\s*\{/);
  });

  it("defaults openings to 1 when null", () => {
    const api = mapPrismaJobToApiJob(prismaJob({ openings: null }));
    expect(api.openings).toBe(1);
  });
});
