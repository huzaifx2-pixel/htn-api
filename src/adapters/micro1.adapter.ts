import { JobSource, EmploymentType, WorkplaceType, JobStatus } from "@prisma/client";
import type { Micro1Client } from "../clients/micro1.client.js";
import type { Micro1Processor } from "../processors/micro1.processor.js";
import type { HTNJob } from "../models/htn-job.model.js";
import type { JobUpsertData } from "../repositories/job.repository.js";
import type { SourceAdapter, SourceJobSummary } from "./source.adapter.js";
import type { Micro1JobSummaryDTO } from "../dto/micro1-job-summary.dto.js";

const ELIGIBLE_JOBS_PAGE_SIZE = 50;

const SOURCE_MAP: Record<string, JobSource> = {
  micro1: JobSource.MICRO1,
  greenhouse: JobSource.GREENHOUSE,
  lever: JobSource.LEVER,
  ashby: JobSource.ASHBY,
  workday: JobSource.WORKDAY,
  linkedin: JobSource.LINKEDIN,
  manual: JobSource.MANUAL,
  other: JobSource.OTHER,
};

const EMPLOYMENT_TYPE_MAP: Record<string, EmploymentType> = {
  FULL_TIME: EmploymentType.FULL_TIME,
  PART_TIME: EmploymentType.PART_TIME,
  CONTRACT: EmploymentType.CONTRACT,
  TEMPORARY: EmploymentType.TEMPORARY,
  INTERNSHIP: EmploymentType.INTERNSHIP,
  INTERN: EmploymentType.INTERNSHIP,
  FREELANCE: EmploymentType.FREELANCE,
  VOLUNTEER: EmploymentType.VOLUNTEER,
};

const STATUS_MAP: Record<string, JobStatus> = {
  open: JobStatus.ACTIVE,
  active: JobStatus.ACTIVE,
  new: JobStatus.ACTIVE,
  paused: JobStatus.ON_HOLD,
  filled: JobStatus.CLOSED,
  closed: JobStatus.CLOSED,
  expired: JobStatus.CLOSED,
  archived: JobStatus.ARCHIVED,
};

const WORKPLACE_TYPE_MAP: Record<string, { type: WorkplaceType; remote: boolean }> = {
  Remote: { type: WorkplaceType.REMOTE, remote: true },
  Hybrid: { type: WorkplaceType.HYBRID, remote: true },
  Onsite: { type: WorkplaceType.ON_SITE, remote: false },
  Unknown: { type: WorkplaceType.ON_SITE, remote: false },
};

function joinArray(items: string[] | undefined): string | null {
  if (!items || items.length === 0) return null;
  return items.join("\n");
}

function mapSource(source: string): JobSource {
  return SOURCE_MAP[source.toLowerCase()] ?? JobSource.OTHER;
}

function mapEmploymentType(type?: string): EmploymentType | null {
  if (!type) return null;
  const normalized = type.toUpperCase().replace(/[-\s]/g, "_");
  return EMPLOYMENT_TYPE_MAP[normalized] ?? null;
}

function mapWorkplaceType(workModel?: string): { type: WorkplaceType | null; remote: boolean } {
  if (!workModel) return { type: null, remote: false };
  const mapped = WORKPLACE_TYPE_MAP[workModel];
  return mapped ?? { type: null, remote: false };
}

function mapStatus(status?: string): JobStatus {
  if (!status) return JobStatus.IMPORTED;
  return STATUS_MAP[status.toLowerCase()] ?? JobStatus.IMPORTED;
}

export class Micro1SyncAdapter implements SourceAdapter {
  readonly source = JobSource.MICRO1;

  constructor(
    private readonly client: Micro1Client,
    private readonly processor: Micro1Processor,
  ) {}

  async getJobSummaries(syncStart: Date): Promise<SourceJobSummary[]> {
    const firstPage = await this.client.getJobs(1, ELIGIBLE_JOBS_PAGE_SIZE);

    if (!firstPage.data.length) {
      throw new Error(
        "No jobs returned from Micro1 eligible-jobs (refer.micro1.ai/opportunities).",
      );
    }

    const totalJobs = firstPage.total;
    const totalPages = Math.ceil(totalJobs / ELIGIBLE_JOBS_PAGE_SIZE);

    console.log(
      `[Micro1] Fetching ${totalJobs} assigned jobs across ${totalPages} pages...`,
    );

    const allSummaries: Micro1JobSummaryDTO[] = [...firstPage.data];

    for (let page = 2; page <= totalPages; page++) {
      const portal = await this.client.getJobs(page, ELIGIBLE_JOBS_PAGE_SIZE);
      allSummaries.push(...portal.data);
      console.log(
        `[Micro1] Page ${page}/${totalPages}: ${portal.data.length} jobs`,
      );
    }

    const withApplyUrl = allSummaries.filter((summary) => summary.apply_url);

    if (withApplyUrl.length < allSummaries.length) {
      console.warn(
        `[Micro1] Skipping ${allSummaries.length - withApplyUrl.length} jobs with no apply_url`,
      );
    }

    return withApplyUrl.map((summary) => ({
      applyUrl: summary.apply_url,
      externalId: summary.job_id,
      title: summary.job_name,
      companyName: summary.company_name,
      openings: summary.no_of_openings ?? null,
      skills: Array.isArray(summary.skills) ? summary.skills : [],
      compensation: {
        hourly:
          summary.ideal_hourly_rate &&
          (summary.ideal_hourly_rate.min != null ||
            summary.ideal_hourly_rate.max != null)
            ? {
                min: toFiniteNumber(summary.ideal_hourly_rate.min) ?? undefined,
                max: toFiniteNumber(summary.ideal_hourly_rate.max) ?? undefined,
              }
            : undefined,
        monthly:
          summary.ideal_monthly_salary_min != null ||
          summary.ideal_monthly_salary_max != null
            ? {
                min:
                  toFiniteNumber(summary.ideal_monthly_salary_min) ?? undefined,
                max:
                  toFiniteNumber(summary.ideal_monthly_salary_max) ?? undefined,
              }
            : undefined,
        yearly: (() => {
          const y = summary.ideal_yearly_compensation;
          if (y == null) return undefined;
          if (typeof y === "number") return y;
          const min = toFiniteNumber(y.min) ?? undefined;
          const max = toFiniteNumber(y.max) ?? undefined;
          if (min == null && max == null) return undefined;
          return { min, max };
        })(),
      },
    }));
  }

  async getJobDetails(summary: SourceJobSummary): Promise<HTNJob> {
    // Scrape for description/content; pay/skills/openings prefer the Opportunities feed.
    const job = await this.processor.process(summary.applyUrl);
    job.sourceUrl = summary.applyUrl;
    if (summary.externalId?.trim()) {
      job.externalId = summary.externalId.trim();
    }

    if (summary.title?.trim()) {
      job.title = summary.title.trim();
    }
    if (summary.companyName?.trim()) {
      job.company = {
        ...job.company,
        name: summary.companyName.trim(),
      };
    }
    if (summary.openings != null) {
      job.openings = summary.openings;
    }
    if (summary.skills && summary.skills.length > 0) {
      job.skills = summary.skills;
    }
    if (summary.compensation) {
      job.compensation = {
        ...job.compensation,
        currency: summary.compensation.currency ?? job.compensation?.currency,
        hourly: summary.compensation.hourly ?? job.compensation?.hourly,
        monthly: summary.compensation.monthly ?? job.compensation?.monthly,
        yearly:
          summary.compensation.yearly !== undefined
            ? summary.compensation.yearly
            : job.compensation?.yearly,
      };
    }

    return job;
  }

  mapToUpsertData(job: HTNJob, organizationId: string, syncStart: Date): JobUpsertData {
    const { type: workplaceType, remote } = mapWorkplaceType(job.location?.workModel);

    const hourlyMin = toFiniteNumber(job.compensation?.hourly?.min);
    const hourlyMax = toFiniteNumber(job.compensation?.hourly?.max);
    const monthlyMin = toFiniteNumber(job.compensation?.monthly?.min);
    const monthlyMax = toFiniteNumber(job.compensation?.monthly?.max);
    const yearlyRange = normalizeYearlyCompensation(job.compensation?.yearly);

    const hasHourly = hourlyMin != null || hourlyMax != null;
    const hasMonthly = monthlyMin != null || monthlyMax != null;
    const hasYearly = yearlyRange.min != null || yearlyRange.max != null;

    const salaryMin = hasHourly
      ? hourlyMin
      : hasMonthly
        ? monthlyMin
        : hasYearly
          ? yearlyRange.min
          : null;
    const salaryMax = hasHourly
      ? hourlyMax
      : hasMonthly
        ? monthlyMax
        : hasYearly
          ? yearlyRange.max
          : null;
    const payRatePeriod = hasHourly
      ? "hourly"
      : hasMonthly
        ? "monthly"
        : hasYearly
          ? "yearly"
          : null;

    // Prefer feed referral URL stored on sourceUrl by getJobDetails.
    const referralApplyUrl = job.sourceUrl ?? null;

    return {
      externalId: job.externalId,
      source: mapSource(job.source),
      title: job.title,
      organizationId,
      description: job.description ?? null,
      summary: job.content?.summary ?? null,
      responsibilities: joinArray(job.content?.responsibilities),
      requirements: joinArray(job.content?.requirements),
      preferredQualifications: joinArray(job.content?.preferredQualifications),
      benefits: joinArray(job.content?.benefits),
      employmentType: mapEmploymentType(job.employmentType),
      workplaceType,
      remote,
      postedAt: job.postedAt ?? null,
      expiresAt: job.expiresAt ?? null,
      applyUrl: referralApplyUrl,
      canonicalUrl: referralApplyUrl,
      status: mapStatus(job.status),
      skillNames: job.skills,
      salaryMin,
      salaryMax,
      salaryCurrency: job.compensation?.currency ?? null,
      openings: job.openings ?? 1,
      location: job.location?.name ?? null,
      country: job.location?.countries?.[0] ?? null,
      lastSeenAt: syncStart,
      lastSyncedAt: syncStart,
      metadata: {
        ...job.metadata,
        origin: "micro1",
        payRatePeriod,
        compensationDetails: job.content?.compensation ?? null,
        aboutCompany: job.content?.aboutCompany ?? null,
      },
    };
  }
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeYearlyCompensation(
  yearly: HTNJob["compensation"] extends { yearly?: infer Y } ? Y : unknown,
): { min: number | null; max: number | null } {
  if (yearly == null) return { min: null, max: null };
  if (typeof yearly === "object" && !Array.isArray(yearly)) {
    const obj = yearly as { min?: unknown; max?: unknown };
    return {
      min: toFiniteNumber(obj.min),
      max: toFiniteNumber(obj.max),
    };
  }
  const n = toFiniteNumber(yearly);
  return { min: n, max: n };
}
