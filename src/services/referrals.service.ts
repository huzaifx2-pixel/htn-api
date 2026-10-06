import { ApplicationSource, Prisma } from "@prisma/client";

import {
  buildExpertWorkStatus,
  type ExpertWorkStatus,
} from "../lib/micro1-referral-fields.js";
import prisma from "../prisma/client.js";

export interface ReferralCandidateItem {
  id: string;
  externalId: string | null;
  /** My Referrals → Name */
  name: string;
  email: string | null;
  /** My Referrals → Date of referral */
  dateOfReferral: string | null;
  /** My Referrals → Status (Micro1 tracker, e.g. applying) */
  status: string | null;
  /** My Referrals → Expert's work status */
  expertWorkStatus: ExpertWorkStatus | null;
  /** My Referrals → Applications count */
  applicationCount: number;
  /**
   * My Referrals → Payout amount when Micro1 has assigned one.
   * null when not shown / not yet eligible.
   */
  payout: number | null;
  /** @deprecated Prefer dateOfReferral — kept for earlier consumers */
  dateReferred: string | null;
  /** @deprecated Prefer status — kept for earlier consumers */
  micro1Status: string | null;
}

export interface ReferralListResult {
  candidates: ReferralCandidateItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

function asRecord(
  metadata: Prisma.JsonValue | null,
): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  return metadata as Record<string, unknown>;
}

function readString(
  metadata: Prisma.JsonValue | null,
  key: string,
): string | null {
  const value = asRecord(metadata)?.[key];
  return typeof value === "string" ? value : null;
}

function readNumber(
  metadata: Prisma.JsonValue | null,
  key: string,
): number | null {
  const value = asRecord(metadata)?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function readExpertWorkStatus(
  metadata: Prisma.JsonValue | null,
): ExpertWorkStatus | null {
  const raw = asRecord(metadata)?.expertWorkStatus;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    if (typeof o.label === "string") {
      return {
        label: o.label,
        hoursWorked: Number(o.hoursWorked) || 0,
        hoursThreshold: Number(o.hoursThreshold) || 10,
        tasksCompleted: Number(o.tasksCompleted) || 0,
        requiredMinimumTasks: Number(o.requiredMinimumTasks) || 1,
        projectType: typeof o.projectType === "string" ? o.projectType : null,
        isPpt: Boolean(o.isPpt),
        isHoursThresholdMet: Boolean(o.isHoursThresholdMet),
        percent: Number(o.percent) || 0,
      };
    }
  }

  // Rebuild from raw fields when older synced rows lack expertWorkStatus.
  if (!asRecord(metadata)) return null;
  return buildExpertWorkStatus({
    totalHoursWorked: readNumber(metadata, "totalHoursWorked"),
    totalHoursThreshold: readNumber(metadata, "totalHoursThreshold"),
    totalTasksCompleted: readNumber(metadata, "totalTasksCompleted"),
    requiredMinimumTasks: readNumber(metadata, "requiredMinimumTasks"),
    isHoursThresholdMet: asRecord(metadata)?.isHoursThresholdMet as
      | number
      | boolean
      | null
      | undefined,
    projectType: readString(metadata, "projectType"),
    referralMetadata: asRecord(metadata)?.referralMetadata,
  });
}

export async function getReferralCandidates(
  page: number = 1,
  limit: number = 20,
): Promise<ReferralListResult> {
  const safePage = Math.max(page, 1);
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const skip = (safePage - 1) * safeLimit;

  const where: Prisma.CandidateWhereInput = {
    applications: {
      some: {
        source: ApplicationSource.REFERRAL,
      },
    },
  };

  const originWhere: Prisma.CandidateWhereInput = {
    OR: [
      where,
      {
        metadata: {
          path: ["origin"],
          equals: "micro1",
        },
      },
    ],
  };

  const [total, rows] = await Promise.all([
    prisma.candidate.count({ where: originWhere }),
    prisma.candidate.findMany({
      where: originWhere,
      orderBy: { updatedAt: "desc" },
      skip,
      take: safeLimit,
      include: {
        _count: {
          select: {
            applications: {
              where: { source: ApplicationSource.REFERRAL },
            },
          },
        },
      },
    }),
  ]);

  const candidates: ReferralCandidateItem[] = rows.map((row) => {
    const status =
      readString(row.metadata, "status") ??
      readString(row.metadata, "micro1Status");
    const dateOfReferral =
      readString(row.metadata, "dateOfReferral") ??
      readString(row.metadata, "dateReferred");
    const expertWorkStatus = readExpertWorkStatus(row.metadata);

    const applicationCount =
      readNumber(row.metadata, "applicationCount") ??
      readNumber(row.metadata, "jobApplicationCount") ??
      row._count.applications;

    const payout =
      readNumber(row.metadata, "payout") ??
      readNumber(row.metadata, "payoutAmount");

    return {
      id: row.id,
      externalId: row.externalId,
      name: `${row.firstName} ${row.lastName}`.trim(),
      email: row.email,
      dateOfReferral,
      status,
      expertWorkStatus,
      applicationCount,
      payout,
      dateReferred: dateOfReferral,
      micro1Status: status,
    };
  });

  return {
    candidates,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
}
