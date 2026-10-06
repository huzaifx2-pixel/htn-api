import { JobSource } from "@prisma/client";
import type { HTNJob } from "../models/htn-job.model.js";
import type { JobUpsertData } from "../repositories/job.repository.js";

export interface SourceJobSummary {
  applyUrl: string;
  /** Micro1 job UUID from eligible-jobs feed (preferred over scrape id). */
  externalId?: string;
  title: string;
  companyName: string;
  /** Feed openings from eligible-jobs (Opportunities cards). */
  openings?: number | null;
  /** Feed required skills. */
  skills?: string[];
  /** Feed compensation — authoritative for Pay column. */
  compensation?: {
    currency?: string;
    hourly?: { min?: number; max?: number };
    monthly?: { min?: number; max?: number };
    yearly?: number | { min?: number; max?: number };
  };
}


export interface SourceAdapter {
  readonly source: JobSource;

  getJobSummaries(syncStart: Date): Promise<SourceJobSummary[]>;

  getJobDetails(summary: SourceJobSummary): Promise<HTNJob>;

  mapToUpsertData(
    job: HTNJob,
    organizationId: string,
    syncStart: Date,
  ): JobUpsertData;
}
