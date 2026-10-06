const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Prefer MICRO1_REFERRAL_CODE; otherwise decode `id` from MICRO1_REFERRAL_TOKEN JWT.
 */
export function resolveMicro1ReferralCode(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const explicit = env.MICRO1_REFERRAL_CODE?.trim();
  if (explicit) return explicit;

  const token = env.MICRO1_REFERRAL_TOKEN?.trim();
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length < 2) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { id?: unknown };
    return typeof payload.id === "string" && payload.id.trim()
      ? payload.id.trim()
      : null;
  } catch {
    return null;
  }
}

/** Build a Micro1 post URL with this portal's referralCode. */
export function buildMicro1ReferralUrl(
  jobId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const id = jobId?.trim();
  if (!id || !UUID_RE.test(id)) return null;

  const code = resolveMicro1ReferralCode(env);
  if (!code) {
    return `https://jobs.micro1.ai/post/${id}`;
  }

  const params = new URLSearchParams({
    referralCode: code,
    utm_source: "referral",
    utm_medium: "share",
    utm_campaign: "job_referral",
  });
  return `https://jobs.micro1.ai/post/${id}?${params.toString()}`;
}

/**
 * Prefer a stored apply URL; otherwise synthesize from Micro1 job UUID.
 */
export function resolveJobReferralLink(input: {
  applyUrl?: string | null;
  canonicalUrl?: string | null;
  externalId?: string | null;
  source?: string | null;
}): string {
  const stored =
    (input.applyUrl ?? "").trim() || (input.canonicalUrl ?? "").trim();
  if (stored) return stored;

  const source = (input.source ?? "").toUpperCase();
  if (source && source !== "MICRO1") return "";

  return buildMicro1ReferralUrl(input.externalId) ?? "";
}
