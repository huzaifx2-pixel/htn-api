import type { Micro1ReferralSummaryDTO } from "./micro1-referral-summary.dto.js";
import type { Micro1ReferralAppliedJobDTO } from "./micro1-referral-applied-job.dto.js";

export interface Micro1ReferralsResponseDTO {
  status: boolean;
  message: string;
  statusCode: number;
  total: number;
  data: Micro1ReferralSummaryDTO[];
}

export interface Micro1ReferralAppliedJobsResponseDTO {
  status: boolean;
  message: string;
  statusCode: number;
  total: number;
  data: Micro1ReferralAppliedJobDTO[];
}
