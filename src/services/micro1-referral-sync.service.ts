import {
  ApplicationSource,
  ApplicationStatus,
  CandidateStatus,
  JobSource,
  Prisma,
} from "@prisma/client";

import type { Micro1ReferralAppliedJobDTO } from "../dto/micro1-referral-applied-job.dto.js";
import type { Micro1ReferralSummaryDTO } from "../dto/micro1-referral-summary.dto.js";
import {
  buildExpertWorkStatusFromReferral,
  mapAppliedJobsToRoles,
} from "../lib/micro1-referral-fields.js";
import prisma from "../prisma/client.js";
import { getMicro1Client } from "./micro1-sync.service.js";

const REFERRALS_PAGE_SIZE = 50;
const APPLIED_JOBS_PAGE_SIZE = 50;

export interface Micro1ReferralSyncResult {
  totalSeen: number;
  totalCandidatesCreated: number;
  totalCandidatesUpdated: number;
  totalApplicationsCreated: number;
  totalApplicationsUpdated: number;
  totalSkippedMissingJob: number;
  totalFailed: number;
  syncStart: Date;
  syncEnd: Date;
}

export function splitCandidateName(name: string): {
  firstName: string;
  lastName: string;
} {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return { firstName: "Unknown", lastName: "Candidate" };
  }
  const parts = trimmed.split(" ");
  if (parts.length === 1) {
    return { firstName: parts[0]!, lastName: "-" };
  }
  return {
    firstName: parts[0]!,
    lastName: parts.slice(1).join(" "),
  };
}

/** Map Micro1 tracker status → ApplicationStatus; store raw in metadata. */
export function mapMicro1StatusToApplicationStatus(
  micro1Status: string | null | undefined,
): ApplicationStatus {
  const status = (micro1Status ?? "").trim().toLowerCase();
  switch (status) {
    case "applying":
    case "existing-micro1-user":
      return ApplicationStatus.APPLIED;
    case "ai-interview-completed":
    case "ai-interview":
      return ApplicationStatus.INTERVIEW;
    case "criteria-met":
    case "minimum-criteria-met":
    case "certified":
      return ApplicationStatus.SCREENING;
    case "matched":
    case "matched-to-project":
    case "started":
      return ApplicationStatus.OFFER;
    case "paid":
    case "successful":
      return ApplicationStatus.ACCEPTED;
    case "unsuccessful":
    case "rejected":
      return ApplicationStatus.REJECTED;
    default:
      return ApplicationStatus.APPLIED;
  }
}

function parseMicro1Date(value: string | null | undefined): Date | null {
  if (!value || typeof value !== "string") return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function applicationExternalId(referralId: string, jobId: string): string {
  return `${referralId}:${jobId}`;
}

function toPayoutAmount(
  value: number | string | null | undefined,
): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildCandidateMetadata(
  referral: Micro1ReferralSummaryDTO,
  rolesAppliedTo: ReturnType<typeof mapAppliedJobsToRoles> = [],
): Prisma.InputJsonValue {
  const expertWorkStatus = buildExpertWorkStatusFromReferral(referral);
  const payout = toPayoutAmount(referral.payout_amount);
  return {
    origin: "micro1",
    // My Referrals table columns
    name: referral.name,
    dateOfReferral: referral.date_referred,
    status: referral.status,
    expertWorkStatus: { ...expertWorkStatus },
    applicationCount: referral.job_application_count ?? rolesAppliedTo.length,
    rolesAppliedTo: rolesAppliedTo.map((r) => ({ ...r })),
    // Payout — null when Micro1 has not shown/assigned one yet
    payout,
    payoutAmount: payout,
    // Raw Micro1 fields
    micro1Status: referral.status,
    dateReferred: referral.date_referred,
    referralMetadata: (referral.referral_metadata ??
      null) as Prisma.InputJsonValue,
    totalHoursWorked: referral.total_hours_worked ?? null,
    totalTasksCompleted: referral.total_tasks_completed ?? null,
    totalHoursThreshold: referral.total_hours_threshold ?? null,
    requiredMinimumTasks: referral.required_minimum_tasks ?? null,
    isHoursThresholdMet: referral.is_hours_threshold_met ?? null,
    projectType: referral.project_type ?? null,
    transactionId: referral.transaction_id ?? null,
    jobApplicationCount: referral.job_application_count ?? null,
    applicationsReady: referral.applications_ready ?? null,
  };
}

async function upsertCandidateFromReferral(
  referral: Micro1ReferralSummaryDTO,
  rolesAppliedTo: ReturnType<typeof mapAppliedJobsToRoles> = [],
): Promise<{ candidateId: string; created: boolean }> {
  const { firstName, lastName } = splitCandidateName(referral.name);
  const referredAt = parseMicro1Date(referral.date_referred);
  const metadata = buildCandidateMetadata(referral, rolesAppliedTo);

  const existing = await prisma.candidate.findFirst({
    where: { externalId: referral.id },
    select: { id: true },
  });

  if (existing) {
    await prisma.candidate.update({
      where: { id: existing.id },
      data: {
        firstName,
        lastName,
        status: CandidateStatus.ACTIVE,
        metadata,
      },
    });
    return { candidateId: existing.id, created: false };
  }

  const created = await prisma.candidate.create({
    data: {
      externalId: referral.id,
      firstName,
      lastName,
      status: CandidateStatus.ACTIVE,
      metadata,
      ...(referredAt ? { createdAt: referredAt } : {}),
    },
  });
  return { candidateId: created.id, created: true };
}

async function fetchAllAppliedJobs(
  referralId: string,
): Promise<Micro1ReferralAppliedJobDTO[]> {
  const client = getMicro1Client();
  const jobs: Micro1ReferralAppliedJobDTO[] = [];
  let page = 1;
  let total = Infinity;

  while (jobs.length < total) {
    const response = await client.getReferralAppliedJobs(
      referralId,
      page,
      APPLIED_JOBS_PAGE_SIZE,
    );
    total = response.total;
    jobs.push(...response.data);
    if (response.data.length === 0) break;
    page += 1;
    if (page > 100) break;
  }

  return jobs;
}

async function upsertApplicationForJob(params: {
  candidateId: string;
  referral: Micro1ReferralSummaryDTO;
  appliedJob: Micro1ReferralAppliedJobDTO;
}): Promise<"created" | "updated" | "skipped_missing_job"> {
  const { candidateId, referral, appliedJob } = params;
  const job = await prisma.job.findFirst({
    where: {
      source: JobSource.MICRO1,
      externalId: appliedJob.job_id,
    },
    select: { id: true },
  });

  if (!job) {
    console.warn(
      `[Micro1 referrals] No MICRO1 job for externalId=${appliedJob.job_id} (referral=${referral.id}); skipping application.`,
    );
    return "skipped_missing_job";
  }

  const submittedAt = parseMicro1Date(appliedJob.applied_on);
  const status = mapMicro1StatusToApplicationStatus(referral.status);
  const externalId = applicationExternalId(referral.id, appliedJob.job_id);
  const metadata: Prisma.InputJsonValue = {
    origin: "micro1",
    micro1Status: referral.status,
    micro1ReferralId: referral.id,
    jobName: appliedJob.job_name,
    companyName: appliedJob.company_name ?? null,
    appliedOn: appliedJob.applied_on ?? null,
    isJobHiredFor: appliedJob.is_job_hired_for ?? null,
    applyUrl: appliedJob.apply_url ?? null,
  };

  const existing = await prisma.application.findUnique({
    where: {
      candidateId_jobId: {
        candidateId,
        jobId: job.id,
      },
    },
    select: { id: true },
  });

  if (existing) {
    await prisma.application.update({
      where: { id: existing.id },
      data: {
        externalId,
        source: ApplicationSource.REFERRAL,
        status,
        submittedAt: submittedAt ?? undefined,
        metadata,
      },
    });
    return "updated";
  }

  await prisma.application.create({
    data: {
      externalId,
      candidateId,
      jobId: job.id,
      source: ApplicationSource.REFERRAL,
      status,
      submittedAt: submittedAt ?? undefined,
      metadata,
    },
  });
  return "created";
}

export async function runMicro1ReferralSync(options?: {
  /** Max referral candidates to process (for tests / dry runs). */
  limit?: number;
  /**
   * When true, also fetch each referral's applied-jobs and upsert Application rows.
   * Default false — ingest no longer returns roles, and fetching jobs for ~600
   * referrals exceeds Railway request timeouts.
   */
  includeAppliedJobs?: boolean;
}): Promise<Micro1ReferralSyncResult> {
  const client = getMicro1Client();
  if (!client.getAuthToken()) {
    throw new Error(
      "Not authenticated with Micro1. Complete OTP login first (request-otp + verify-otp).",
    );
  }

  const syncStart = new Date();
  const result: Micro1ReferralSyncResult = {
    totalSeen: 0,
    totalCandidatesCreated: 0,
    totalCandidatesUpdated: 0,
    totalApplicationsCreated: 0,
    totalApplicationsUpdated: 0,
    totalSkippedMissingJob: 0,
    totalFailed: 0,
    syncStart,
    syncEnd: syncStart,
  };

  const maxReferrals = options?.limit;
  const includeAppliedJobs = options?.includeAppliedJobs === true;
  let page = 1;
  let total = Infinity;
  let processed = 0;

  while (processed < total) {
    const portal = await client.getReferrals(page, REFERRALS_PAGE_SIZE);
    total = portal.total;
    const totalPages = Math.max(1, Math.ceil(total / REFERRALS_PAGE_SIZE));
    console.log(
      `[Micro1 referrals] Page ${page}/${totalPages}: ${portal.data.length} referrals (total=${total}, seen=${processed})`,
    );
    if (portal.data.length === 0) break;

    for (const referral of portal.data) {
      if (maxReferrals != null && processed >= maxReferrals) {
        result.syncEnd = new Date();
        return result;
      }

      result.totalSeen += 1;
      processed += 1;

      try {
        if (!referral.id || !referral.name) {
          result.totalFailed += 1;
          continue;
        }

        const appCount = Number(referral.job_application_count ?? 0);
        const appliedJobs =
          includeAppliedJobs && Number.isFinite(appCount) && appCount > 0
            ? await fetchAllAppliedJobs(referral.id)
            : [];
        const rolesAppliedTo = mapAppliedJobsToRoles(appliedJobs);

        const { candidateId, created } = await upsertCandidateFromReferral(
          referral,
          rolesAppliedTo,
        );
        if (created) result.totalCandidatesCreated += 1;
        else result.totalCandidatesUpdated += 1;

        for (const appliedJob of appliedJobs) {
          if (!appliedJob.job_id) {
            result.totalFailed += 1;
            continue;
          }
          const outcome = await upsertApplicationForJob({
            candidateId,
            referral,
            appliedJob,
          });
          if (outcome === "created") result.totalApplicationsCreated += 1;
          else if (outcome === "updated") result.totalApplicationsUpdated += 1;
          else result.totalSkippedMissingJob += 1;
        }
      } catch (error) {
        result.totalFailed += 1;
        console.error(
          `[Micro1 referrals] Failed referral id=${referral.id}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    if (portal.data.length < REFERRALS_PAGE_SIZE) break;
    page += 1;
    if (page > 500) break;
  }

  result.syncEnd = new Date();
  console.log(
    `[Micro1 referrals] Done. seen=${result.totalSeen}/${total} created=${result.totalCandidatesCreated} updated=${result.totalCandidatesUpdated} failed=${result.totalFailed}`,
  );
  return result;
}
