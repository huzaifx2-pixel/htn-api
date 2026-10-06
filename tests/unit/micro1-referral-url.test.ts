import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  buildMicro1ReferralUrl,
  resolveJobReferralLink,
  resolveMicro1ReferralCode,
} from "../../src/lib/micro1-referral-url.js";

describe("micro1-referral-url", () => {
  const prevCode = process.env.MICRO1_REFERRAL_CODE;
  const prevToken = process.env.MICRO1_REFERRAL_TOKEN;

  beforeEach(() => {
    delete process.env.MICRO1_REFERRAL_CODE;
    delete process.env.MICRO1_REFERRAL_TOKEN;
  });

  afterEach(() => {
    if (prevCode === undefined) delete process.env.MICRO1_REFERRAL_CODE;
    else process.env.MICRO1_REFERRAL_CODE = prevCode;
    if (prevToken === undefined) delete process.env.MICRO1_REFERRAL_TOKEN;
    else process.env.MICRO1_REFERRAL_TOKEN = prevToken;
  });

  it("reads referral code from env", () => {
    process.env.MICRO1_REFERRAL_CODE = "abc-123";
    expect(resolveMicro1ReferralCode()).toBe("abc-123");
  });

  it("decodes referral code from JWT id claim", () => {
    const payload = Buffer.from(
      JSON.stringify({ id: "452891ab-aef5-4aaf-8258-92b549ba33c0" }),
    ).toString("base64url");
    process.env.MICRO1_REFERRAL_TOKEN = `hdr.${payload}.sig`;
    expect(resolveMicro1ReferralCode()).toBe(
      "452891ab-aef5-4aaf-8258-92b549ba33c0",
    );
  });

  it("builds a full referral URL for a job UUID", () => {
    process.env.MICRO1_REFERRAL_CODE = "452891ab-aef5-4aaf-8258-92b549ba33c0";
    const url = buildMicro1ReferralUrl("0936cd2a-a0a9-4105-802a-a4ec81cbf466");
    expect(url).toContain(
      "https://jobs.micro1.ai/post/0936cd2a-a0a9-4105-802a-a4ec81cbf466?",
    );
    expect(url).toContain(
      "referralCode=452891ab-aef5-4aaf-8258-92b549ba33c0",
    );
  });

  it("prefers stored applyUrl over synthesis", () => {
    const link = resolveJobReferralLink({
      applyUrl: "https://jobs.micro1.ai/post/x?referralCode=stored",
      externalId: "0936cd2a-a0a9-4105-802a-a4ec81cbf466",
      source: "MICRO1",
    });
    expect(link).toContain("referralCode=stored");
  });

  it("synthesizes when applyUrl missing for Micro1", () => {
    process.env.MICRO1_REFERRAL_CODE = "code-1";
    const link = resolveJobReferralLink({
      applyUrl: null,
      externalId: "0936cd2a-a0a9-4105-802a-a4ec81cbf466",
      source: "MICRO1",
    });
    expect(link).toContain("referralCode=code-1");
  });
});
