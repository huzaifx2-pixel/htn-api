import { describe, it, expect } from "vitest";
import { ApplicationStatus } from "@prisma/client";
import {
  buildExpertWorkStatus,
  mapAppliedJobsToRoles,
} from "../../src/lib/micro1-referral-fields.js";
import {
  mapMicro1StatusToApplicationStatus,
  splitCandidateName,
} from "../../src/services/micro1-referral-sync.service.js";

describe("splitCandidateName", () => {
  it("splits first and last name", () => {
    expect(splitCandidateName("Cheryl Julian")).toEqual({
      firstName: "Cheryl",
      lastName: "Julian",
    });
  });

  it("keeps multi-word last names", () => {
    expect(splitCandidateName("Mary Ann Smith")).toEqual({
      firstName: "Mary",
      lastName: "Ann Smith",
    });
  });

  it("handles single-token names", () => {
    expect(splitCandidateName("Madonna")).toEqual({
      firstName: "Madonna",
      lastName: "-",
    });
  });

  it("falls back for empty names", () => {
    expect(splitCandidateName("   ")).toEqual({
      firstName: "Unknown",
      lastName: "Candidate",
    });
  });
});

describe("mapMicro1StatusToApplicationStatus", () => {
  it("maps known Micro1 tracker statuses", () => {
    expect(mapMicro1StatusToApplicationStatus("applying")).toBe(
      ApplicationStatus.APPLIED,
    );
    expect(mapMicro1StatusToApplicationStatus("ai-interview-completed")).toBe(
      ApplicationStatus.INTERVIEW,
    );
    expect(mapMicro1StatusToApplicationStatus("certified")).toBe(
      ApplicationStatus.SCREENING,
    );
    expect(mapMicro1StatusToApplicationStatus("matched-to-project")).toBe(
      ApplicationStatus.OFFER,
    );
    expect(mapMicro1StatusToApplicationStatus("paid")).toBe(
      ApplicationStatus.ACCEPTED,
    );
    expect(mapMicro1StatusToApplicationStatus("unsuccessful")).toBe(
      ApplicationStatus.REJECTED,
    );
  });

  it("defaults unknown statuses to APPLIED", () => {
    expect(mapMicro1StatusToApplicationStatus("something-new")).toBe(
      ApplicationStatus.APPLIED,
    );
  });
});

describe("buildExpertWorkStatus", () => {
  it("formats hourly Expert's work status like Micro1 UI", () => {
    const status = buildExpertWorkStatus({
      totalHoursWorked: "0",
      totalHoursThreshold: null,
      totalTasksCompleted: 0,
      requiredMinimumTasks: 1,
      isHoursThresholdMet: 0,
      projectType: null,
    });
    expect(status.label).toBe("0 hours");
    expect(status.hoursWorked).toBe(0);
    expect(status.hoursThreshold).toBe(10);
    expect(status.percent).toBe(0);
    expect(status.isPpt).toBe(false);
  });

  it("formats PPT task progress", () => {
    const status = buildExpertWorkStatus({
      totalHoursWorked: 0,
      totalTasksCompleted: 1,
      requiredMinimumTasks: 2,
      projectType: "PPT",
    });
    expect(status.label).toBe("1 completed task");
    expect(status.isPpt).toBe(true);
    expect(status.percent).toBe(50);
  });
});

describe("mapAppliedJobsToRoles", () => {
  it("maps Virtual Assistant applied-on role", () => {
    const roles = mapAppliedJobsToRoles([
      {
        job_id: "4fb1fcad-4ff0-4c45-bfa7-2b447295f01b",
        job_name: "Virtual Assistant",
        company_name: "micro1",
        applied_on: "2026-09-24 14:50:18",
        apply_url: "https://jobs.micro1.ai/post/x",
      },
    ]);
    expect(roles).toEqual([
      {
        jobExternalId: "4fb1fcad-4ff0-4c45-bfa7-2b447295f01b",
        jobTitle: "Virtual Assistant",
        company: "micro1",
        appliedOn: "2026-09-24 14:50:18",
        applyUrl: "https://jobs.micro1.ai/post/x",
      },
    ]);
  });
});
