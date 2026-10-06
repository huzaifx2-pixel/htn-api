export interface Job {
  /** External / ATS job id shown on careers */
  jobId: string;

  /** Client / company name (ATS "Client" column) */
  client: string;

  /** Alias of client for older consumers */
  company: string;

  title: string;

  /** Job description (ATS "Job Description" column) */
  description: string;

  /** Number of openings */
  openings: number;

  /** Required skills */
  skills: string[];

  /** Formatted pay string, e.g. "$40–$60/hr" */
  pay: string;

  /** Referral apply URL with referralCode (ATS "Referral Link") */
  referralLink: string;

  /** Alias of referralLink for older consumers */
  applyUrl: string;

  /** Careers detail fields (headsbaseinc.com job page) */
  employmentType?: string | null;
  locationType?: string | null;
  postedDate?: string | null;
  responsibilities?: string;
  requirements?: string;
  preferredQualifications?: string;
  remote?: boolean | null;
  source?: string;
}
