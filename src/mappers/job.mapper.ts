import type { Job as ApiJob } from "../types/job.js";
import type { JobWithRelations } from "../repositories/job.repository.js";
import type { Prisma } from "@prisma/client";
import { normalizeAtsRequirements } from "../lib/ats-requirements.js";
import { resolveJobReferralLink } from "../lib/micro1-referral-url.js";

function money(value: number, currency: string | null | undefined): string {
  const code = (currency || "USD").toUpperCase();
  const formatted = Number.isInteger(value)
    ? value.toLocaleString("en-US")
    : value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  if (code === "USD") return `$${formatted}`;
  return `${code} ${formatted}`;
}

function range(
  min: number | null | undefined,
  max: number | null | undefined,
  currency: string | null | undefined,
): string | null {
  const hasMin = min != null && Number.isFinite(Number(min));
  const hasMax = max != null && Number.isFinite(Number(max));
  if (!hasMin && !hasMax) return null;
  if (hasMin && hasMax && Number(min) !== Number(max)) {
    return `${money(Number(min), currency)}-${money(Number(max), currency)}`;
  }
  return money(Number(hasMin ? min : max), currency);
}

type PayMeta = {
  payRatePeriod?: string | null;
  compensationDetails?: string | null;
};

function readMeta(metadata: Prisma.JsonValue | null | undefined): PayMeta {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  const obj = metadata as Record<string, unknown>;
  return {
    payRatePeriod:
      typeof obj.payRatePeriod === "string" ? obj.payRatePeriod : null,
    compensationDetails:
      typeof obj.compensationDetails === "string"
        ? obj.compensationDetails
        : null,
  };
}

function formatEnumLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatJobPay(prismaJob: {
  salaryMin?: Prisma.Decimal | number | null;
  salaryMax?: Prisma.Decimal | number | null;
  salaryCurrency?: string | null;
  metadata?: Prisma.JsonValue | null;
}): string {
  const meta = readMeta(prismaJob.metadata ?? null);
  const min =
    prismaJob.salaryMin == null ? null : Number(prismaJob.salaryMin);
  const max =
    prismaJob.salaryMax == null ? null : Number(prismaJob.salaryMax);
  const amount = range(min, max, prismaJob.salaryCurrency);

  if (amount) {
    const period = (meta.payRatePeriod || "").toLowerCase();
    if (period === "hourly") return `${amount}/hr`;
    if (period === "monthly") return `${amount}/mo`;
    if (period === "yearly" || period === "annual") return `${amount}/yr`;
    // Micro1 Opportunities cards are almost always hourly when rates are small.
    const high = Math.max(min ?? 0, max ?? 0);
    if (high > 0 && high < 1000) return `${amount}/hr`;
    if (high >= 1000) return `${amount}/yr`;
    return amount;
  }

  if (meta.compensationDetails?.trim()) {
    return meta.compensationDetails.trim();
  }

  return "";
}

export function mapPrismaJobToApiJob(prismaJob: JobWithRelations): ApiJob {
  const client = prismaJob.organization?.name ?? "";
  const referralLink = resolveJobReferralLink({
    applyUrl: prismaJob.applyUrl,
    canonicalUrl: prismaJob.canonicalUrl,
    externalId: prismaJob.externalId,
    source: prismaJob.source,
  });
  const skillNames = prismaJob.jobSkills.map((js) => js.skill.name);
  const normalizedReqs = normalizeAtsRequirements(prismaJob.requirements);
  const skills =
    skillNames.length > 0 ? skillNames : normalizedReqs.skillNames;

  let locationType = formatEnumLabel(prismaJob.workplaceType);
  if (!locationType && prismaJob.remote === true) {
    locationType = "Remote";
  }

  return {
    jobId: prismaJob.externalId ?? "",
    client,
    company: client,
    title: prismaJob.title,
    description: prismaJob.description ?? "",
    openings: prismaJob.openings ?? 1,
    skills,
    pay: formatJobPay(prismaJob),
    referralLink,
    applyUrl: referralLink,
    employmentType: formatEnumLabel(prismaJob.employmentType),
    locationType,
    postedDate: prismaJob.postedAt
      ? prismaJob.postedAt.toISOString()
      : null,
    responsibilities: prismaJob.responsibilities ?? "",
    requirements: normalizedReqs.requirementsText ?? "",
    preferredQualifications: prismaJob.preferredQualifications ?? "",
    remote: prismaJob.remote,
    source: prismaJob.source?.toLowerCase?.() ?? undefined,
  };
}
