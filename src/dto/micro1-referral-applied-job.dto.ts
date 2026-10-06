export interface Micro1ReferralAppliedJobDTO {
  job_id: string;
  job_name: string;
  company_name?: string | null;
  role_type?: string | null;
  domain_slug?: string | null;
  engagement_type?: string | null;
  location_type?: string | null;
  date_posted?: string | null;
  no_of_openings?: number | null;
  skills?: string[] | null;
  is_job_hired_for?: number | boolean | null;
  applied_on?: string | null;
  job_type?: string | null;
  apply_url?: string | null;
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
