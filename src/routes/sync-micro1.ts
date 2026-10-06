import { Router } from "express";
import { AppError, isAppError } from "../errors/app-error.js";
import { requireSyncApiKey } from "../middleware/sync-auth.js";
import {
  getMicro1Client,
  reconcileMicro1FromFeed,
  requestMicro1Otp,
  runMicro1Sync,
  verifyMicro1Otp,
} from "../services/micro1-sync.service.js";
import { runMicro1ReferralSync } from "../services/micro1-referral-sync.service.js";

const router = Router();

router.use(requireSyncApiKey);

function handleRouteError(error: unknown, res: import("express").Response) {
  if (isAppError(error)) {
    return res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }

  const message = error instanceof Error ? error.message : "Internal server error";
  console.error("Micro1 sync route error:", message);

  const status =
    /not authenticated|otp|MICRO1_REFERRAL/i.test(message) ? 400 : 500;

  return res.status(status).json({
    success: false,
    message,
  });
}

/**
 * POST /api/sync/micro1/auth/request-otp
 * Body: { email?: string } — defaults to MICRO1_REFERRAL_EMAIL
 */
router.post("/auth/request-otp", async (req, res) => {
  try {
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim() : undefined;
    const result = await requestMicro1Otp(email);

    return res.status(200).json({
      success: true,
      data: {
        email: result.email,
        isAlreadyRegistered: result.isAlreadyRegistered,
        message: "OTP sent. Check email and call /auth/verify-otp with the code.",
      },
    });
  } catch (error) {
    return handleRouteError(error, res);
  }
});

/**
 * POST /api/sync/micro1/auth/verify-otp
 * Body: { otp: string, email?: string, otpHash?: string }
 */
router.post("/auth/verify-otp", async (req, res) => {
  try {
    const otp =
      typeof req.body?.otp === "string"
        ? req.body.otp.trim()
        : typeof req.body?.otpCode === "string"
          ? req.body.otpCode.trim()
          : "";

    if (!otp) {
      throw new AppError("VALIDATION_ERROR", "otp is required", 400);
    }

    const email =
      typeof req.body?.email === "string" ? req.body.email.trim() : undefined;
    const otpHash =
      typeof req.body?.otpHash === "string"
        ? req.body.otpHash.trim()
        : undefined;

    const result = await verifyMicro1Otp(otp, email, otpHash);

    return res.status(200).json({
      success: true,
      data: {
        email: result.email,
        name: result.name,
        authenticated: true,
      },
    });
  } catch (error) {
    return handleRouteError(error, res);
  }
});

/**
 * GET /api/sync/micro1/auth/status
 */
router.get("/auth/status", (_req, res) => {
  const client = getMicro1Client();
  return res.status(200).json({
    success: true,
    data: {
      authenticated: Boolean(client.getAuthToken()),
      email: client.getEmail() ?? null,
    },
  });
});

/**
 * POST /api/sync/micro1/run
 * Body: { limit?: number, mode?: "full" | "feed" }
 * - full (default): scrape each opportunity (slow)
 * - feed: fast reconcile from eligible-jobs (reopen/create/close) for ATS Sync Now
 */
router.post("/run", async (req, res) => {
  try {
    const limitRaw = req.body?.limit;
    const limit =
      typeof limitRaw === "number" && Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.floor(limitRaw)
        : undefined;

    const mode =
      req.body?.mode === "feed" || req.body?.mode === "full"
        ? req.body.mode
        : "full";

    if (mode === "feed") {
      const result = await reconcileMicro1FromFeed();
      return res.status(200).json({
        success: true,
        data: {
          mode: "feed",
          ...result,
        },
      });
    }

    const result = await runMicro1Sync(limit);

    return res.status(200).json({
      success: true,
      data: {
        mode: "full",
        source: result.source,
        syncStart: result.syncStart.toISOString(),
        syncEnd: result.syncEnd.toISOString(),
        totalSeen: result.totalSeen,
        totalCreated: result.totalCreated,
        totalUpdated: result.totalUpdated,
        totalFailed: result.totalFailed,
        totalStale: result.totalStale,
      },
    });
  } catch (error) {
    return handleRouteError(error, res);
  }
});

/**
 * POST /api/sync/micro1/referrals/run
 * Body: { limit?: number } — optional cap on referral candidates processed
 * Pulls My Referrals + applied-jobs from Micro1 into Candidate/Application (REFERRAL).
 */
router.post("/referrals/run", async (req, res) => {
  try {
    const limitRaw = req.body?.limit;
    const limit =
      typeof limitRaw === "number" && Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.floor(limitRaw)
        : undefined;

    const includeAppliedJobs = req.body?.includeAppliedJobs === true;

    const result = await runMicro1ReferralSync({ limit, includeAppliedJobs });

    return res.status(200).json({
      success: true,
      data: {
        syncStart: result.syncStart.toISOString(),
        syncEnd: result.syncEnd.toISOString(),
        includeAppliedJobs,
        totalSeen: result.totalSeen,
        totalCandidatesCreated: result.totalCandidatesCreated,
        totalCandidatesUpdated: result.totalCandidatesUpdated,
        totalApplicationsCreated: result.totalApplicationsCreated,
        totalApplicationsUpdated: result.totalApplicationsUpdated,
        totalSkippedMissingJob: result.totalSkippedMissingJob,
        totalFailed: result.totalFailed,
      },
    });
  } catch (error) {
    return handleRouteError(error, res);
  }
});

export default router;
