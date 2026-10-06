import fs from "fs";
import path from "path";
import axios, { AxiosInstance, isAxiosError } from "axios";

import type { Micro1PortalResponseDTO } from "../dto/micro1-portal-response.dto.js";
import type {
  Micro1ReferralAppliedJobsResponseDTO,
  Micro1ReferralsResponseDTO,
} from "../dto/micro1-referrals-response.dto.js";

const API_BASE_URL = "https://prod-api.micro1.ai/api/v1";

const TOKEN_HELP =
  "Call POST /api/sync/micro1/auth/request-otp then POST /api/sync/micro1/auth/verify-otp with the email OTP, or set MICRO1_REFERRAL_TOKEN.";

const DEFAULT_SESSION_PATH = path.resolve(process.cwd(), ".micro1-session.json");

export interface Micro1ClientOptions {
  authToken?: string;
  email?: string;
  http?: AxiosInstance;
  sessionPath?: string;
  timezone?: string;
}

export interface Micro1OtpRequestResult {
  email: string;
  otpHash: string;
  isAlreadyRegistered: boolean | null;
}

export interface Micro1OtpVerifyResult {
  token: string;
  email: string;
  name: string | null;
}

interface SessionFile {
  token?: string;
  email?: string;
  otpHash?: string;
  updatedAt?: string;
}

export class Micro1Client {
  private readonly client: AxiosInstance;
  private readonly sessionPath: string;
  private readonly timezone: string;
  private authToken: string | undefined;
  private email: string | undefined;
  private pendingOtpHash: string | undefined;

  constructor(options: Micro1ClientOptions = {}) {
    this.sessionPath = options.sessionPath ?? DEFAULT_SESSION_PATH;
    this.timezone =
      options.timezone ??
      process.env.MICRO1_TIMEZONE?.trim() ??
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      "UTC";

    const session = this.readSessionFile();
    this.authToken =
      (options.authToken ??
        process.env.MICRO1_REFERRAL_TOKEN ??
        session?.token)?.trim() || undefined;
    this.email =
      (options.email ??
        process.env.MICRO1_REFERRAL_EMAIL ??
        session?.email)?.trim() || undefined;
    this.pendingOtpHash = session?.otpHash?.trim() || undefined;

    this.client =
      options.http ??
      axios.create({
        baseURL: API_BASE_URL,
        timeout: 30000,
        headers: {
          accept: "application/json",
          "Content-Type": "application/json",
          "x-custom-lang": "en",
        },
      });

    this.applyAuthHeader();
  }

  getAuthToken(): string | undefined {
    return this.authToken;
  }

  getEmail(): string | undefined {
    return this.email;
  }

  setAuthToken(token: string | undefined): void {
    this.authToken = token?.trim() || undefined;
    if (this.authToken) {
      process.env.MICRO1_REFERRAL_TOKEN = this.authToken;
    }
    this.applyAuthHeader();
    this.writeSessionFile();
  }

  /**
   * Jobs assigned to the logged-in referrer on
   * https://refer.micro1.ai/opportunities
   */
  async getJobs(
    page: number = 1,
    limit: number = 50,
  ): Promise<Micro1PortalResponseDTO> {
    if (!this.authToken) {
      throw new Error(
        `MICRO1_REFERRAL_TOKEN is required to sync assigned referral jobs. ${TOKEN_HELP}`,
      );
    }

    try {
      const { data } = await this.client.get("/referral/portal/eligible-jobs", {
        params: {
          page,
          limit,
          sort_by: "date_created",
          sort_direction: "desc",
        },
      });

      const jobs = Array.isArray(data?.data) ? data.data : [];

      console.log({
        total: data?.total,
        page,
        limit,
        returned: jobs.length,
      });

      return {
        status: data?.status ?? true,
        message: data?.message ?? "",
        statusCode: data?.statusCode ?? 200,
        total: data?.total ?? jobs.length,
        data: jobs,
      };
    } catch (error: unknown) {
      if (isAxiosError(error) && error.response?.status === 401) {
        throw new Error(
          `Micro1 referral session expired or is invalid. ${TOKEN_HELP}`,
        );
      }

      console.error("Micro1 API Error:");
      if (isAxiosError(error)) {
        console.error(error.response?.data);
      }

      throw error;
    }
  }

  /**
   * Candidates referred by the logged-in user on
   * https://refer.micro1.ai/my-referrals
   */
  async getReferrals(
    page: number = 1,
    limit: number = 50,
  ): Promise<Micro1ReferralsResponseDTO> {
    if (!this.authToken) {
      throw new Error(
        `MICRO1_REFERRAL_TOKEN is required to sync referral candidates. ${TOKEN_HELP}`,
      );
    }

    try {
      const { data } = await this.client.get("/referral/portal/my-referrals", {
        params: {
          page,
          limit,
          sort_by: "date_referred",
          sort_direction: "desc",
        },
      });

      const referrals = Array.isArray(data?.data) ? data.data : [];
      const total = Number(data?.total);
      return {
        status: data?.status ?? true,
        message: data?.message ?? "",
        statusCode: data?.statusCode ?? 200,
        total: Number.isFinite(total) ? total : referrals.length,
        data: referrals,
      };
    } catch (error: unknown) {
      if (isAxiosError(error) && error.response?.status === 401) {
        throw new Error(
          `Micro1 referral session expired or is invalid. ${TOKEN_HELP}`,
        );
      }

      console.error("Micro1 my-referrals API Error:");
      if (isAxiosError(error)) {
        console.error(error.response?.data);
      }

      throw error;
    }
  }

  /**
   * Jobs a referred candidate applied to (Roles applied to drawer).
   */
  async getReferralAppliedJobs(
    referralId: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<Micro1ReferralAppliedJobsResponseDTO> {
    if (!this.authToken) {
      throw new Error(
        `MICRO1_REFERRAL_TOKEN is required to sync referral applications. ${TOKEN_HELP}`,
      );
    }

    const id = referralId?.trim();
    if (!id) {
      throw new Error("referralId is required to fetch applied jobs.");
    }

    try {
      const { data } = await this.client.get(
        `/referral/portal/my-referrals/${id}/applied-jobs`,
        {
          params: {
            page,
            limit,
          },
        },
      );

      const jobs = Array.isArray(data?.data) ? data.data : [];
      const total = Number(data?.total);
      return {
        status: data?.status ?? true,
        message: data?.message ?? "",
        statusCode: data?.statusCode ?? 200,
        total: Number.isFinite(total) ? total : jobs.length,
        data: jobs,
      };
    } catch (error: unknown) {
      if (isAxiosError(error) && error.response?.status === 401) {
        throw new Error(
          `Micro1 referral session expired or is invalid. ${TOKEN_HELP}`,
        );
      }

      console.error("Micro1 applied-jobs API Error:");
      if (isAxiosError(error)) {
        console.error(error.response?.data);
      }

      throw error;
    }
  }

  async requestOtp(email?: string): Promise<Micro1OtpRequestResult> {
    const resolvedEmail = (email ?? this.email)?.trim();
    if (!resolvedEmail) {
      throw new Error(
        "MICRO1_REFERRAL_EMAIL is required (or pass email to requestOtp).",
      );
    }

    try {
      const { data } = await this.client.post(
        "/referral/portal/auth/check-email",
        {
          email_id: resolvedEmail,
          timezone: this.timezone,
        },
      );

      if (!data?.status) {
        throw new Error(data?.message || "Failed to request Micro1 OTP.");
      }

      const otpHash = data?.data?.otp_hash;
      if (!otpHash || typeof otpHash !== "string") {
        throw new Error("Micro1 OTP response did not include otp_hash.");
      }

      this.email = resolvedEmail;
      this.pendingOtpHash = otpHash;
      process.env.MICRO1_REFERRAL_EMAIL = resolvedEmail;
      this.writeSessionFile();

      return {
        email: resolvedEmail,
        otpHash,
        isAlreadyRegistered:
          typeof data?.data?.is_already_registered === "boolean"
            ? data.data.is_already_registered
            : null,
      };
    } catch (error: unknown) {
      if (error instanceof Error && !isAxiosError(error)) {
        throw error;
      }
      console.error("Micro1 OTP request failed:");
      if (isAxiosError(error)) {
        console.error(error.response?.data);
        throw new Error(
          typeof error.response?.data?.message === "string"
            ? error.response.data.message
            : "Failed to request Micro1 OTP.",
        );
      }
      throw error;
    }
  }

  async verifyOtp(
    otpCode: string,
    email?: string,
    otpHash?: string,
  ): Promise<Micro1OtpVerifyResult> {
    const resolvedEmail = (email ?? this.email)?.trim();
    const resolvedHash = (otpHash ?? this.pendingOtpHash)?.trim();
    const code = otpCode.trim();

    if (!resolvedEmail) {
      throw new Error(
        "MICRO1_REFERRAL_EMAIL is required (or pass email to verifyOtp).",
      );
    }
    if (!resolvedHash) {
      throw new Error(
        "No pending OTP hash. Call requestOtp first, or pass otpHash.",
      );
    }
    if (!code) {
      throw new Error("OTP code is required.");
    }

    try {
      const { data } = await this.client.post(
        "/referral/portal/auth/login/verify",
        {
          email_id: resolvedEmail,
          otp_hash: resolvedHash,
          otp_code: code,
          timezone: this.timezone,
        },
      );

      if (!data?.status || !data?.data?.token) {
        throw new Error(data?.message || "Micro1 OTP verification failed.");
      }

      const token = String(data.data.token);
      const user = data.data.user;
      this.email = resolvedEmail;
      this.pendingOtpHash = undefined;
      this.setAuthToken(token);

      return {
        token,
        email: user?.email_id ?? resolvedEmail,
        name: user?.name ?? null,
      };
    } catch (error: unknown) {
      if (error instanceof Error && !isAxiosError(error)) {
        throw error;
      }
      console.error("Micro1 OTP verify failed:");
      if (isAxiosError(error)) {
        console.error(error.response?.data);
        throw new Error(
          typeof error.response?.data?.message === "string"
            ? error.response.data.message
            : "Micro1 OTP verification failed.",
        );
      }
      throw error;
    }
  }

  async fetch(url: string): Promise<string> {
    const { data } = await axios.get<string>(url, {
      headers: this.authToken
        ? { Authorization: `Bearer ${this.authToken}` }
        : undefined,
    });

    return data;
  }

  private applyAuthHeader(): void {
    if (!this.client.defaults) {
      return;
    }

    const defaults = this.client.defaults as {
      headers?: { common?: Record<string, unknown> } & Record<string, unknown>;
    };

    if (!defaults.headers) {
      defaults.headers = {};
    }
    if (!defaults.headers.common) {
      defaults.headers.common = {};
    }

    if (this.authToken) {
      defaults.headers.common.Authorization = `Bearer ${this.authToken}`;
    } else {
      delete defaults.headers.common.Authorization;
    }
  }

  private readSessionFile(): SessionFile | null {
    try {
      if (!fs.existsSync(this.sessionPath)) {
        return null;
      }
      const raw = fs.readFileSync(this.sessionPath, "utf8");
      return JSON.parse(raw) as SessionFile;
    } catch {
      return null;
    }
  }

  private writeSessionFile(): void {
    const payload: SessionFile = {
      token: this.authToken,
      email: this.email,
      otpHash: this.pendingOtpHash,
      updatedAt: new Date().toISOString(),
    };

    try {
      fs.writeFileSync(this.sessionPath, JSON.stringify(payload, null, 2));
    } catch (error) {
      console.warn(
        "Failed to persist Micro1 session file:",
        error instanceof Error ? error.message : error,
      );
    }
  }
}
