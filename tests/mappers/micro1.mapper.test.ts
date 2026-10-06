import { describe, it, expect } from "vitest";
import { Micro1Mapper } from "../../src/mappers/micro1.mapper.js";
import type { Micro1JobDetailDTO } from "../../src/dto/micro1-job-detail.dto.js";

function detail(overrides: Partial<Micro1JobDetailDTO> = {}): Micro1JobDetailDTO {
  return {
    source: "micro1",
    externalId: "ext-1",
    canonicalUrl: "https://jobs.micro1.ai/post/ext-1",
    title: "Attorney",
    description: "Legal work",
    content: {
      summary: "summary",
      responsibilities: [],
      requirements: [],
      preferredQualifications: [],
      benefits: [],
      additionalSections: {},
    },
    company: { name: "Acme", id: "c1" },
    location: { name: "Remote", type: "remote", countries: ["US"] },
    employmentType: "CONTRACT",
    compensation: {
      hourlyMin: 40,
      hourlyMax: 60,
      monthlyMin: undefined,
      monthlyMax: undefined,
      yearly: undefined,
      referralReward: 100,
    },
    status: "open",
    roleType: "EXPERT",
    domain: "legal",
    openings: 2,
    directApply: true,
    postedAt: new Date("2026-01-01"),
    validUntil: undefined,
    skills: ["Writing"],
    screeningQuestions: [],
    ...overrides,
  };
}

describe("Micro1Mapper", () => {
  it("maps openings and compensation onto HTNJob", () => {
    const job = new Micro1Mapper().map(detail());

    expect(job.openings).toBe(2);
    expect(job.compensation?.hourly).toEqual({ min: 40, max: 60 });
    expect(job.skills).toEqual(["Writing"]);
    expect(job.company.name).toBe("Acme");
    expect(job.location?.workModel).toBe("Remote");
  });
});
