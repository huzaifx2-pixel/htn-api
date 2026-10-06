export interface Micro1JobSummaryDTO {
  job_id: string;

  job_name: string;

  company_name: string;

  date_posted: string;

  skills: string[];

  role_type: string;

  domain_slug: string;

  job_type: string;

  apply_url: string;

  location_type: string | null;

  engagement_type: string | null;

  no_of_openings?: number | null;

  referral_reward_amount?: number | string | null;

  ideal_monthly_salary_min?: number | null;

  ideal_monthly_salary_max?: number | null;

  ideal_hourly_rate?: {
    min?: number | null;
    max?: number | null;
  } | null;

  ideal_yearly_compensation?:
    | number
    | {
        min?: number | null;
        max?: number | null;
      }
    | null;
}
