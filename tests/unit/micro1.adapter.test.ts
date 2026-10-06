import { describe, it, expect, vi } from "vitest";
import { JobSource, JobStatus } from "@prisma/client";
import { Micro1SyncAdapter } from "../../src/adapters/micro1.adapter.js";
import type { Micro1Client } from "../../src/clients/micro1.client.js";
import type { Micro1Processor } from "../../src/processors/micro1.processor.js";
import type { HTNJob } from "../../src/models/htn-job.model.js";

function summary(overrides: Record<string, unknown> = {}) {
  return {
    job_id: "job-1",
    job_name: "Assigned Role",
    company_name: "Acme",
    date_posted: "2026-08-01",
    skills: ["SQL"],
    role_type: "EXPERT",
    domain_slug: "stem",
    job_type: "EXPERT",
    apply_url: "https://jobs.micro1.ai/post/job-1",
    location_type: "remote",
    engagement_type: "hourly",
    no_of_openings: 5,
    ideal_hourly_rate: { min: 40, max: 60 },
    ideal_monthly_salary_min: null,
    ideal_monthly_salary_max: null,
    ideal_yearly_compensation: null,
    ...overrides,
  };
}

function scrapedJob(overrides: Partial<HTNJob> = {}): HTNJob {
  return {
    id: "hash",
    source: "micro1",
    externalId: "job-1",
    sourceUrl: "https://jobs.micro1.ai/post/job-1",
    title: "Assigned Role",
    company: { name: "Acme" },
    description: "desc",
    content: {
      summary: "summary",
      responsibilities: ["do work"],
      requirements: [],
      preferredQualifications: [],
      benefits: [],
      additionalSections: {},
    },
    location: { workModel: "Remote" },
    employmentType: "CONTRACT",
    status: "open",
    skills: ["SQL"],
    screeningQuestions: [],
    metadata: {},
    directApply: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("Micro1SyncAdapter.getJobSummaries", () => {
  it("pages through assigned eligible jobs and drops rows without apply_url", async () => {
    const getJobs = vi.fn().mockResolvedValueOnce({
      status: true,
      message: "ok",
      statusCode: 200,
      total: 2,
      data: [
        summary({
          job_id: "a",
          job_name: "Role A",
          apply_url: "https://jobs.micro1.ai/post/a",
        }),
        summary({ job_id: "b", job_name: "Role B", apply_url: "" }),
      ],
    });

    const adapter = new Micro1SyncAdapter(
      { getJobs } as unknown as Micro1Client,
      {} as Micro1Processor,
    );

    const jobs = await adapter.getJobSummaries(new Date("2026-08-19T00:00:00Z"));

    expect(getJobs).toHaveBeenCalledWith(1, 50);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      applyUrl: "https://jobs.micro1.ai/post/a",
      title: "Role A",
      companyName: "Acme",
      openings: 5,
      skills: ["SQL"],
      compensation: {
        hourly: { min: 40, max: 60 },
      },
    });
  });
});

describe("Micro1SyncAdapter referral apply URLs", () => {
  it("keeps the feed apply_url with referralCode even when scrape returns a bare URL", async () => {
    const feedUrl =
      "https://jobs.micro1.ai/post/job-1?referralCode=452891ab&utm_source=referral";
    const process = vi
      .fn()
      .mockResolvedValue(
        scrapedJob({ sourceUrl: "https://jobs.micro1.ai/post/job-1" }),
      );

    const adapter = new Micro1SyncAdapter(
      {} as Micro1Client,
      { process } as unknown as Micro1Processor,
    );

    const job = await adapter.getJobDetails({
      applyUrl: feedUrl,
      title: "Assigned Role",
      companyName: "Acme",
    });

    expect(process).toHaveBeenCalledWith(feedUrl);
    expect(job.sourceUrl).toBe(feedUrl);

    const upsert = adapter.mapToUpsertData(
      job,
      "11111111-1111-1111-1111-111111111111",
      new Date("2026-08-19T00:00:00Z"),
    );

    expect(upsert.applyUrl).toBe(feedUrl);
    expect(upsert.canonicalUrl).toBe(feedUrl);
    expect(upsert.source).toBe(JobSource.MICRO1);
    expect(upsert.status).toBe(JobStatus.ACTIVE);
  });

  it("overlays feed pay onto scraped job details", async () => {
    const process = vi.fn().mockResolvedValue(
      scrapedJob({
        compensation: undefined,
        openings: 1,
        skills: [],
      }),
    );

    const adapter = new Micro1SyncAdapter(
      {} as Micro1Client,
      { process } as unknown as Micro1Processor,
    );

    const job = await adapter.getJobDetails({
      applyUrl: "https://jobs.micro1.ai/post/job-1?referralCode=abc",
      title: "Assigned Role",
      companyName: "Acme",
      openings: 100,
      skills: ["Contract Drafting"],
      compensation: { hourly: { min: 90, max: 130 } },
    });

    expect(job.openings).toBe(100);
    expect(job.skills).toEqual(["Contract Drafting"]);
    expect(job.compensation?.hourly).toEqual({ min: 90, max: 130 });
    expect(job.sourceUrl).toContain("referralCode=");
  });

  it("maps openings and hourly pay fields for the import contract", () => {
    const adapter = new Micro1SyncAdapter(
      {} as Micro1Client,
      {} as Micro1Processor,
    );

    const upsert = adapter.mapToUpsertData(
      scrapedJob({
        openings: 3,
        compensation: {
          currency: "USD",
          hourly: { min: 40, max: 60 },
        },
        sourceUrl:
          "https://jobs.micro1.ai/post/job-1?referralCode=452891ab",
      }),
      "11111111-1111-1111-1111-111111111111",
      new Date("2026-08-19T00:00:00Z"),
    );

    expect(upsert.openings).toBe(3);
    expect(upsert.salaryMin).toBe(40);
    expect(upsert.salaryMax).toBe(60);
    expect(upsert.salaryCurrency).toBe("USD");
    expect(upsert.metadata).toMatchObject({ payRatePeriod: "hourly" });
    expect(upsert.applyUrl).toContain("referralCode=");
  });

  it("normalizes yearly compensation objects into numeric salaryMin/Max", () => {
    const adapter = new Micro1SyncAdapter(
      {} as Micro1Client,
      {} as Micro1Processor,
    );

    const upsert = adapter.mapToUpsertData(
      scrapedJob({
        compensation: {
          yearly: { min: 200000, max: 280000 },
        },
      }),
      "11111111-1111-1111-1111-111111111111",
      new Date("2026-08-19T00:00:00Z"),
    );

    expect(upsert.salaryMin).toBe(200000);
    expect(upsert.salaryMax).toBe(280000);
    expect(upsert.metadata).toMatchObject({ payRatePeriod: "yearly" });
  });
});
