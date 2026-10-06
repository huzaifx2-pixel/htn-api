import { JobSource, JobStatus, Prisma } from "@prisma/client";
import prisma from "../prisma/client.js";
import { Micro1Client } from "../clients/micro1.client.js";
import { Micro1Parser } from "../parsers/micro1.parser.js";
import { Micro1Mapper } from "../mappers/micro1.mapper.js";
import { Micro1Processor } from "../processors/micro1.processor.js";
import { Micro1SyncAdapter } from "../adapters/micro1.adapter.js";
import { SourceSyncService } from "./sync.service.js";
import type { SyncResult } from "./sync.service.js";
import { JobRepository } from "../repositories/job.repository.js";
import { OrganizationRepository } from "../repositories/organization.repository.js";
import { formatJobPay } from "../mappers/job.mapper.js";

let sharedClient: Micro1Client | undefined;

export function getMicro1Client(): Micro1Client {
  if (!sharedClient) {
    sharedClient = new Micro1Client();
  }
  return sharedClient;
}

/** Test helper — reset singleton between tests. */
export function resetMicro1ClientForTests(): void {
  sharedClient = undefined;
}

export async function requestMicro1Otp(email?: string) {
  return getMicro1Client().requestOtp(email);
}

export async function verifyMicro1Otp(
  otp: string,
  email?: string,
  otpHash?: string,
) {
  return getMicro1Client().verifyOtp(otp, email, otpHash);
}

export async function runMicro1Sync(limit?: number): Promise<SyncResult> {
  const client = getMicro1Client();
  if (!client.getAuthToken()) {
    throw new Error(
      "Not authenticated with Micro1. Complete OTP login first (request-otp + verify-otp).",
    );
  }

  const processor = new Micro1Processor(
    client,
    new Micro1Parser(),
    new Micro1Mapper(),
  );
  const adapter = new Micro1SyncAdapter(client, processor);
  const syncService = new SourceSyncService(adapter);
  return syncService.sync(limit);
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function yearlyRange(yearly: unknown): { min: number | null; max: number | null } {
  if (yearly == null) return { min: null, max: null };
  if (typeof yearly === "object" && !Array.isArray(yearly)) {
    const o = yearly as { min?: unknown; max?: unknown };
    return { min: toNum(o.min), max: toNum(o.max) };
  }
  const n = toNum(yearly);
  return { min: n, max: n };
}

function floorToSeconds(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

export type Micro1FeedReconcileResult = {
  feedTotal: number;
  reopened: number;
  updated: number;
  created: number;
  failed: number;
  staleClosed: number;
  syncStart: string;
  syncEnd: string;
};

/**
 * Fast reconcile used before ATS "Sync from HTN Now":
 * - Pull eligible-jobs pages (no HTML scrape for existing rows)
 * - Re-activate CLOSED Micro1 jobs still on the feed
 * - Refresh applyUrl / openings / pay
 * - Full-scrape only jobs missing from HTN
 * - Close Micro1 jobs no longer on the feed
 */
export async function reconcileMicro1FromFeed(): Promise<Micro1FeedReconcileResult> {
  const client = getMicro1Client();
  if (!client.getAuthToken()) {
    throw new Error(
      "Not authenticated with Micro1. Complete OTP login first (request-otp + verify-otp).",
    );
  }

  const syncStart = floorToSeconds(new Date());
  const pageSize = 50;
  const first = await client.getJobs(1, pageSize);
  const rows = [...first.data];
  const totalPages = Math.ceil(first.total / pageSize);
  for (let page = 2; page <= totalPages; page++) {
    const portal = await client.getJobs(page, pageSize);
    rows.push(...portal.data);
  }

  const existing = await prisma.job.findMany({
    where: { source: JobSource.MICRO1 },
    select: { id: true, externalId: true, status: true, metadata: true },
  });
  const byExternal = new Map(
    existing
      .filter((j) => j.externalId)
      .map((j) => [j.externalId as string, j]),
  );

  const jobRepo = new JobRepository();
  const orgRepo = new OrganizationRepository();

  let reopened = 0;
  let updated = 0;
  let created = 0;
  let failed = 0;
  const missingSummaries: Array<{
    applyUrl: string;
    externalId: string;
    title: string;
    companyName: string;
    openings?: number | null;
    skills?: string[];
    compensation?: {
      hourly?: { min?: number; max?: number };
      monthly?: { min?: number; max?: number };
      yearly?: number | { min?: number; max?: number };
    };
  }> = [];

  // Fast path: update existing rows in parallel batches (no HTML scrape).
  type UpdateTask = {
    jobId: string;
    wasClosed: boolean;
    title: string;
    data: Prisma.JobUpdateInput;
  };
  const updateTasks: UpdateTask[] = [];

  for (const row of rows) {
    if (!row.job_id || !row.apply_url) continue;
    const job = byExternal.get(row.job_id);

    if (!job) {
      missingSummaries.push({
        applyUrl: row.apply_url,
        externalId: row.job_id,
        title: row.job_name,
        companyName: row.company_name,
        openings: row.no_of_openings ?? null,
        skills: Array.isArray(row.skills) ? row.skills : [],
        compensation: {
          hourly:
            row.ideal_hourly_rate &&
            (row.ideal_hourly_rate.min != null ||
              row.ideal_hourly_rate.max != null)
              ? {
                  min: toNum(row.ideal_hourly_rate.min) ?? undefined,
                  max: toNum(row.ideal_hourly_rate.max) ?? undefined,
                }
              : undefined,
          monthly:
            row.ideal_monthly_salary_min != null ||
            row.ideal_monthly_salary_max != null
              ? {
                  min: toNum(row.ideal_monthly_salary_min) ?? undefined,
                  max: toNum(row.ideal_monthly_salary_max) ?? undefined,
                }
              : undefined,
          yearly: (() => {
            const y = row.ideal_yearly_compensation;
            if (y == null) return undefined;
            if (typeof y === "number") return y;
            const min = toNum(y.min) ?? undefined;
            const max = toNum(y.max) ?? undefined;
            if (min == null && max == null) return undefined;
            return { min, max };
          })(),
        },
      });
      continue;
    }

    const hourlyMin = toNum(row.ideal_hourly_rate?.min);
    const hourlyMax = toNum(row.ideal_hourly_rate?.max);
    const monthlyMin = toNum(row.ideal_monthly_salary_min);
    const monthlyMax = toNum(row.ideal_monthly_salary_max);
    const yearly = yearlyRange(row.ideal_yearly_compensation);
    const hasHourly = hourlyMin != null || hourlyMax != null;
    const hasMonthly = monthlyMin != null || monthlyMax != null;
    const hasYearly = yearly.min != null || yearly.max != null;
    const salaryMin = hasHourly
      ? hourlyMin
      : hasMonthly
        ? monthlyMin
        : yearly.min;
    const salaryMax = hasHourly
      ? hourlyMax
      : hasMonthly
        ? monthlyMax
        : yearly.max;
    const payRatePeriod = hasHourly
      ? "hourly"
      : hasMonthly
        ? "monthly"
        : hasYearly
          ? "yearly"
          : null;

    const prior =
      job.metadata &&
      typeof job.metadata === "object" &&
      !Array.isArray(job.metadata)
        ? (job.metadata as Record<string, unknown>)
        : {};

    const wasClosed =
      job.status === JobStatus.CLOSED || job.status === JobStatus.ARCHIVED;
    const pay = formatJobPay({
      salaryMin,
      salaryMax,
      salaryCurrency: "USD",
      metadata: { payRatePeriod },
    });

    updateTasks.push({
      jobId: job.id,
      wasClosed,
      title: row.job_name,
      data: {
        status: JobStatus.ACTIVE,
        title: row.job_name?.trim() || undefined,
        openings: row.no_of_openings ?? 1,
        applyUrl: row.apply_url,
        canonicalUrl: row.apply_url,
        salaryMin,
        salaryMax,
        salaryCurrency: "USD",
        lastSeenAt: syncStart,
        lastSyncedAt: new Date(),
        metadata: {
          ...prior,
          origin: "micro1",
          payRatePeriod,
          feedPay: pay || null,
        } as Prisma.InputJsonValue,
      },
    });
  }

  const BATCH = 40;
  for (let i = 0; i < updateTasks.length; i += BATCH) {
    const chunk = updateTasks.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      chunk.map((task) =>
        prisma.job.update({ where: { id: task.jobId }, data: task.data }),
      ),
    );
    results.forEach((result, idx) => {
      if (result.status === "fulfilled") {
        if (chunk[idx].wasClosed) reopened += 1;
        else updated += 1;
      } else {
        failed += 1;
        console.error(
          `[Micro1 reconcile] Failed update ${chunk[idx].title}`,
          result.reason,
        );
      }
    });
  }

  // Create missing jobs from feed fields only (no HTML scrape) so Sync Now stays fast.
  for (const summary of missingSummaries) {
    try {
      const orgId = await orgRepo.findOrCreate({
        name: summary.companyName || "micro1",
      });
      const hourlyMin = summary.compensation?.hourly?.min ?? null;
      const hourlyMax = summary.compensation?.hourly?.max ?? null;
      const monthlyMin = summary.compensation?.monthly?.min ?? null;
      const monthlyMax = summary.compensation?.monthly?.max ?? null;
      const yearly = yearlyRange(summary.compensation?.yearly);
      const hasHourly = hourlyMin != null || hourlyMax != null;
      const hasMonthly = monthlyMin != null || monthlyMax != null;
      const hasYearly = yearly.min != null || yearly.max != null;
      const salaryMin = hasHourly
        ? hourlyMin
        : hasMonthly
          ? monthlyMin
          : yearly.min;
      const salaryMax = hasHourly
        ? hourlyMax
        : hasMonthly
          ? monthlyMax
          : yearly.max;
      const payRatePeriod = hasHourly
        ? "hourly"
        : hasMonthly
          ? "monthly"
          : hasYearly
            ? "yearly"
            : null;

      const result = await jobRepo.upsert({
        externalId: summary.externalId,
        source: JobSource.MICRO1,
        title: summary.title,
        organizationId: orgId,
        description: null,
        applyUrl: summary.applyUrl,
        canonicalUrl: summary.applyUrl,
        openings: summary.openings ?? 1,
        salaryMin,
        salaryMax,
        salaryCurrency: "USD",
        status: JobStatus.ACTIVE,
        skillNames: summary.skills ?? [],
        lastSeenAt: syncStart,
        lastSyncedAt: new Date(),
        metadata: {
          origin: "micro1",
          payRatePeriod,
          createdFromFeedOnly: true,
        },
      });
      if (result === "created") created += 1;
      else updated += 1;
    } catch (err) {
      failed += 1;
      console.error(`[Micro1 reconcile] Failed create ${summary.title}`, err);
    }
  }

  let staleClosed = 0;
  if (rows.length > 0) {
    const closed = await prisma.job.updateMany({
      where: {
        source: JobSource.MICRO1,
        status: { notIn: [JobStatus.CLOSED, JobStatus.ARCHIVED] },
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: syncStart } }],
      },
      data: { status: JobStatus.CLOSED },
    });
    staleClosed = closed.count;
  }

  const syncEnd = new Date();
  return {
    feedTotal: rows.length,
    reopened,
    updated,
    created,
    failed,
    staleClosed,
    syncStart: syncStart.toISOString(),
    syncEnd: syncEnd.toISOString(),
  };
}
