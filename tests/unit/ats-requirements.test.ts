import { describe, expect, it } from "vitest";
import { normalizeAtsRequirements } from "../../src/lib/ats-requirements.js";

describe("normalizeAtsRequirements", () => {
  it("turns ATS skills JSON into readable bullets + skill names", () => {
    const raw = JSON.stringify({
      skills: ["Smartphone   Video Recording   Attention to detail"],
      parsedSkills: ["Smartphone Video Recording Attention TO Detail"],
      requiredSkills: ["Smartphone Video Recording Attention TO Detail"],
      preferredSkills: [],
      certifications: [],
      parserVersion: "1.0.0",
    });

    const result = normalizeAtsRequirements(raw);

    expect(result.skillNames.length).toBeGreaterThan(0);
    expect(result.requirementsText).not.toMatch(/^\s*\{/);
    expect(result.requirementsText).toContain("Smartphone");
  });

  it("passes through plain requirements text", () => {
    const result = normalizeAtsRequirements("Must own an iPhone 12 or later");
    expect(result.requirementsText).toBe("Must own an iPhone 12 or later");
    expect(result.skillNames).toEqual([]);
  });

  it("drops unusable JSON without skills instead of exposing the blob", () => {
    const result = normalizeAtsRequirements('{"parserVersion":"1.0.0"}');
    expect(result.requirementsText).toBeNull();
    expect(result.skillNames).toEqual([]);
  });
});
