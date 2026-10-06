import type { Micro1ReferralAppliedJobDTO } from "../dto/micro1-referral-applied-job.dto.js";
import type { Micro1ReferralSummaryDTO } from "../dto/micro1-referral-summary.dto.js";

/** Default hourly threshold used by refer.micro1.ai when none is set. */
export const DEFAULT_HOURS_THRESHOLD = 10;

export interface ExpertWorkStatus {
  /** Display label matching Micro1 UI (e.g. "0 hours", "2 completed tasks"). */
  label: string;
  hoursWorked: number;
  hoursThreshold: number;
  tasksCompleted: number;
  requiredMinimumTasks: number;
  projectType: string | null;
  isPpt: boolean;
  isHoursThresholdMet: boolean;
  percent: number;
}

export interface RoleAppliedTo {
  jobExternalId: string;
  jobTitle: string;
  company: string | null;
  appliedOn: string | null;
  applyUrl: string | null;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function isPptProject(referral: {
  projectType?: string | null;
  referralMetadata?: unknown;
}): boolean {
  if (referral.projectType === "PPT") return true;
  if (
    referral.referralMetadata &&
    typeof referral.referralMetadata === "object" &&
    !Array.isArray(referral.referralMetadata)
  ) {
    const meta = referral.referralMetadata as Record<string, unknown>;
    return meta.project_type === "PPT" || meta.projectType === "PPT";
  }
  return false;
}

/**
 * Build Expert's work status the same way refer.micro1.ai does
 * (hours progress, or PPT task progress).
 */
export function buildExpertWorkStatus(input: {
  totalHoursWorked?: number | string | null;
  totalHoursThreshold?: number | string | null;
  totalTasksCompleted?: number | null;
  requiredMinimumTasks?: number | null;
  isHoursThresholdMet?: number | boolean | null;
  projectType?: string | null;
  referralMetadata?: unknown;
}): ExpertWorkStatus {
  const hoursWorked = toNumber(input.totalHoursWorked);
  const thresholdRaw = toNumber(input.totalHoursThreshold);
  const hoursThreshold =
    thresholdRaw > 0 ? thresholdRaw : DEFAULT_HOURS_THRESHOLD;
  const tasksCompleted = toNumber(input.totalTasksCompleted);
  const requiredMinimumTasks = Math.max(
    1,
    toNumber(input.requiredMinimumTasks, 1),
  );
  const isPpt = isPptProject(input);
  const isHoursThresholdMet =
    input.isHoursThresholdMet === true ||
    input.isHoursThresholdMet === 1 ||
    (isPpt
      ? tasksCompleted >= requiredMinimumTasks
      : hoursWorked >= hoursThreshold);

  if (isPpt) {
    const percent =
      tasksCompleted >= requiredMinimumTasks
        ? 100
        : Math.min(
            100,
            Math.round((tasksCompleted / requiredMinimumTasks) * 100),
          );
    return {
      label: `${tasksCompleted} completed task${tasksCompleted === 1 ? "" : "s"}`,
      hoursWorked,
      hoursThreshold,
      tasksCompleted,
      requiredMinimumTasks,
      projectType: input.projectType ?? "PPT",
      isPpt: true,
      isHoursThresholdMet,
      percent,
    };
  }

  const percent =
    hoursWorked >= hoursThreshold
      ? 100
      : Math.min(100, Math.round((hoursWorked / hoursThreshold) * 100));

  return {
    label: `${hoursWorked} hours`,
    hoursWorked,
    hoursThreshold,
    tasksCompleted,
    requiredMinimumTasks,
    projectType: input.projectType ?? null,
    isPpt: false,
    isHoursThresholdMet,
    percent,
  };
}

export function buildExpertWorkStatusFromReferral(
  referral: Micro1ReferralSummaryDTO,
): ExpertWorkStatus {
  return buildExpertWorkStatus({
    totalHoursWorked: referral.total_hours_worked,
    totalHoursThreshold: referral.total_hours_threshold,
    totalTasksCompleted: referral.total_tasks_completed,
    requiredMinimumTasks: referral.required_minimum_tasks,
    isHoursThresholdMet: referral.is_hours_threshold_met,
    projectType: referral.project_type,
    referralMetadata: referral.referral_metadata,
  });
}

export function mapAppliedJobsToRoles(
  jobs: Micro1ReferralAppliedJobDTO[],
): RoleAppliedTo[] {
  return jobs
    .filter((j) => Boolean(j.job_id))
    .map((j) => ({
      jobExternalId: j.job_id,
      jobTitle: j.job_name,
      company: j.company_name ?? null,
      appliedOn: j.applied_on ?? null,
      applyUrl: j.apply_url ?? null,
    }));
}
