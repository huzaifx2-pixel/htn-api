/**
 * ATS stores Job.requirements as structured JSON (skills parser output).
 * HTN careers expects a human-readable requirements string + skill names.
 */

export type NormalizedAtsRequirements = {
  /** Newline-separated bullets for the careers Requirements section */
  requirementsText: string | null;
  /** Individual skill labels for JobSkill / skills[] */
  skillNames: string[];
};

function uniqueSkills(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const name = raw.replace(/\s+/g, " ").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function skillsFromObject(obj: Record<string, unknown>): string[] {
  const buckets = [
    asStringArray(obj.skills),
    asStringArray(obj.requiredSkills),
    asStringArray(obj.parsedSkills),
    asStringArray(obj.preferredSkills),
  ];

  // Prefer ATS rows that separate skills with 2+ spaces over jammed single strings.
  const ranked = [...buckets].sort((a, b) => {
    const score = (list: string[]) =>
      list.reduce((n, item) => n + (/\s{2,}/.test(item) ? 2 : item.includes(" ") ? 0 : 1), 0);
    return score(b) - score(a);
  });

  const preferred = ranked.flat();

  const expanded = preferred.flatMap((item) => {
    if (/\s{2,}/.test(item)) {
      return item.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean);
    }
    return [item];
  });

  // Drop mega-strings that are just the other skills concatenated with single spaces.
  const cleaned = expanded.filter((item, _i, all) => {
    if (!/\s/.test(item)) return true;
    if (/\s{2,}/.test(item)) return true;
    const words = item.toLowerCase().split(/\s+/);
    if (words.length < 4) return true;
    const others = all
      .filter((x) => x !== item)
      .map((x) => x.toLowerCase());
    if (others.length === 0) return true;
    const covered = others.every((o) => item.toLowerCase().includes(o));
    return !covered;
  });

  return uniqueSkills(cleaned);
}

function looksLikeJsonObject(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("{") && trimmed.endsWith("}");
}

/**
 * Turn ATS requirements (JSON string/object or plain text) into careers-safe text.
 */
export function normalizeAtsRequirements(
  requirements: unknown,
  fallbackText?: string | null,
): NormalizedAtsRequirements {
  const fallback =
    typeof fallbackText === "string" && fallbackText.trim()
      ? fallbackText.trim()
      : null;

  if (requirements == null || requirements === "") {
    return { requirementsText: fallback, skillNames: [] };
  }

  if (typeof requirements === "object" && !Array.isArray(requirements)) {
    const skills = skillsFromObject(requirements as Record<string, unknown>);
    if (skills.length > 0) {
      return {
        requirementsText: skills.join("\n"),
        skillNames: skills,
      };
    }
    return { requirementsText: fallback, skillNames: [] };
  }

  if (typeof requirements !== "string") {
    return { requirementsText: fallback, skillNames: [] };
  }

  const trimmed = requirements.trim();
  if (!trimmed) {
    return { requirementsText: fallback, skillNames: [] };
  }

  if (!looksLikeJsonObject(trimmed)) {
    return { requirementsText: trimmed, skillNames: [] };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const skills = skillsFromObject(parsed as Record<string, unknown>);
      if (skills.length > 0) {
        return {
          requirementsText: skills.join("\n"),
          skillNames: skills,
        };
      }
    }
  } catch {
    // Keep original text if it was not valid JSON.
  }

  // Avoid showing raw JSON blobs on the careers site.
  return { requirementsText: fallback, skillNames: [] };
}
