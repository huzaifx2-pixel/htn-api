export interface Micro1ReferralSummaryDTO {
  id: string;
  name: string;
  status: string;
  date_referred: string;
  payout_amount?: number | string | null;
  referral_metadata?: unknown;
  total_hours_worked?: number | string | null;
  total_tasks_completed?: number | null;
  total_hours_threshold?: number | string | null;
  required_minimum_tasks?: number | null;
  is_hours_threshold_met?: number | boolean | null;
  project_type?: string | null;
  transaction_id?: string | null;
  job_application_count?: number | null;
  applications_ready?: boolean | null;
}
