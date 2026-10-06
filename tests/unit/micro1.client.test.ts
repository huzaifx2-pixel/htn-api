import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AxiosError } from "axios";
import { Micro1Client } from "../../src/clients/micro1.client.js";

const eligibleJob = {
  job_id: "job-1",
  job_name: "Pharmacology Expert",
  company_name: "micro1",
  date_posted: "2026-08-01",
  skills: ["Pharmacology"],
  role_type: "EXPERT",
  domain_slug: "healthcare",
  job_type: "EXPERT",
  apply_url: "https://jobs.micro1.ai/post/job-1?referralCode=abc",
  location_type: "remote",
  engagement_type: "hourly",
};

function tempSessionPath(): string {
  return path.join(
    os.tmpdir(),
    `micro1-session-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
}

describe("Micro1Client.getJobs", () => {
  const get = vi.fn();
  const post = vi.fn();
  let sessionPath: string;

  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    sessionPath = tempSessionPath();
    delete process.env.MICRO1_REFERRAL_TOKEN;
  });

  afterEach(() => {
    try {
      fs.unlinkSync(sessionPath);
    } catch {
      // ignore
    }
  });

  it("throws when no referral token is configured", async () => {
    const client = new Micro1Client({
      authToken: "",
      http: { get, post } as never,
      sessionPath,
    });

    await expect(client.getJobs()).rejects.toThrow("MICRO1_REFERRAL_TOKEN");
    expect(get).not.toHaveBeenCalled();
  });

  it("loads assigned jobs from the referral eligible-jobs endpoint", async () => {
    get.mockResolvedValue({
      data: {
        status: true,
        message: "ok",
        statusCode: 200,
        total: 1,
        data: [eligibleJob],
      },
    });

    const client = new Micro1Client({
      authToken: "session-token",
      http: { get, post } as never,
      sessionPath,
    });

    const result = await client.getJobs(2, 50);

    expect(get).toHaveBeenCalledWith("/referral/portal/eligible-jobs", {
      params: {
        page: 2,
        limit: 50,
        sort_by: "date_created",
        sort_direction: "desc",
      },
    });
    expect(result.total).toBe(1);
    expect(result.data[0]?.apply_url).toBe(eligibleJob.apply_url);
    expect(result.data[0]?.job_name).toBe("Pharmacology Expert");
  });

  it("explains how to refresh the token on 401", async () => {
    const unauthorized = new AxiosError("Unauthorized");
    unauthorized.response = {
      status: 401,
      data: { message: "Unauthorized" },
    } as AxiosError["response"];
    get.mockRejectedValue(unauthorized);

    const client = new Micro1Client({
      authToken: "expired-token",
      http: { get, post } as never,
      sessionPath,
    });

    await expect(client.getJobs()).rejects.toThrow(/session expired/i);
  });
});

describe("Micro1Client.getReferrals", () => {
  const get = vi.fn();
  const post = vi.fn();
  let sessionPath: string;

  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    sessionPath = tempSessionPath();
    delete process.env.MICRO1_REFERRAL_TOKEN;
  });

  afterEach(() => {
    try {
      fs.unlinkSync(sessionPath);
    } catch {
      // ignore
    }
  });

  it("loads referred candidates from my-referrals", async () => {
    get.mockResolvedValue({
      data: {
        status: true,
        message: "Referrals fetched successfully",
        statusCode: 200,
        total: "2",
        data: [
          {
            id: "ref-1",
            name: "Cheryl Julian",
            status: "applying",
            date_referred: "2026-09-24 14:50:19",
            job_application_count: 1,
            applications_ready: true,
          },
        ],
      },
    });

    const client = new Micro1Client({
      authToken: "session-token",
      http: { get, post } as never,
      sessionPath,
    });

    const result = await client.getReferrals(1, 50);

    expect(get).toHaveBeenCalledWith("/referral/portal/my-referrals", {
      params: {
        page: 1,
        limit: 50,
        sort_by: "date_referred",
        sort_direction: "desc",
      },
    });
    expect(result.total).toBe(2);
    expect(result.data[0]?.name).toBe("Cheryl Julian");
    expect(result.data[0]?.job_application_count).toBe(1);
  });

  it("loads applied jobs for a referral", async () => {
    get.mockResolvedValue({
      data: {
        status: true,
        message: "Jobs fetched successfully",
        statusCode: 200,
        total: "1",
        data: [
          {
            job_id: "job-uuid",
            job_name: "Virtual Assistant",
            company_name: "micro1",
            applied_on: "2026-09-24 14:50:18",
            apply_url: "https://jobs.micro1.ai/post/job-uuid?referralCode=abc",
          },
        ],
      },
    });

    const client = new Micro1Client({
      authToken: "session-token",
      http: { get, post } as never,
      sessionPath,
    });

    const result = await client.getReferralAppliedJobs("ref-1", 1, 10);

    expect(get).toHaveBeenCalledWith(
      "/referral/portal/my-referrals/ref-1/applied-jobs",
      {
        params: { page: 1, limit: 10 },
      },
    );
    expect(result.total).toBe(1);
    expect(result.data[0]?.job_name).toBe("Virtual Assistant");
  });
});

describe("Micro1Client OTP auth", () => {
  const get = vi.fn();
  const post = vi.fn();
  let sessionPath: string;

  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    sessionPath = tempSessionPath();
    delete process.env.MICRO1_REFERRAL_TOKEN;
    delete process.env.MICRO1_REFERRAL_EMAIL;
  });

  afterEach(() => {
    try {
      fs.unlinkSync(sessionPath);
    } catch {
      // ignore
    }
  });

  it("requests OTP via check-email and stores otp hash", async () => {
    post.mockResolvedValue({
      data: {
        status: true,
        message: "OTP sent successfully!",
        data: {
          otp_hash: "hash-123",
          is_already_registered: true,
        },
      },
    });

    const client = new Micro1Client({
      http: { get, post } as never,
      sessionPath,
      timezone: "America/New_York",
    });

    const result = await client.requestOtp("user@example.com");

    expect(post).toHaveBeenCalledWith("/referral/portal/auth/check-email", {
      email_id: "user@example.com",
      timezone: "America/New_York",
    });
    expect(result.otpHash).toBe("hash-123");
    expect(result.isAlreadyRegistered).toBe(true);

    const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    expect(session.otpHash).toBe("hash-123");
    expect(session.email).toBe("user@example.com");
  });

  it("verifies OTP and persists the session token", async () => {
    post
      .mockResolvedValueOnce({
        data: {
          status: true,
          data: { otp_hash: "hash-123", is_already_registered: true },
        },
      })
      .mockResolvedValueOnce({
        data: {
          status: true,
          data: {
            token: "jwt-token",
            user: {
              email_id: "user@example.com",
              name: "Test User",
            },
          },
        },
      });

    const client = new Micro1Client({
      http: { get, post } as never,
      sessionPath,
      timezone: "UTC",
    });

    await client.requestOtp("user@example.com");
    const verified = await client.verifyOtp("424555");

    expect(post).toHaveBeenNthCalledWith(
      2,
      "/referral/portal/auth/login/verify",
      {
        email_id: "user@example.com",
        otp_hash: "hash-123",
        otp_code: "424555",
        timezone: "UTC",
      },
    );
    expect(verified.token).toBe("jwt-token");
    expect(client.getAuthToken()).toBe("jwt-token");
    expect(process.env.MICRO1_REFERRAL_TOKEN).toBe("jwt-token");

    const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    expect(session.token).toBe("jwt-token");
    expect(session.otpHash).toBeUndefined();
  });
});
