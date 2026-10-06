import { Router } from "express";
import { getJobs } from "../services/jobs.service.js";
import type { JobFilters } from "../services/jobs.service.js";
import { getReferralCandidates } from "../services/referrals.service.js";
import { requireSyncApiKey } from "../middleware/sync-auth.js";

const router = Router();

router.use(requireSyncApiKey);

/**
 * GET /api/ingest/jobs
 * Micro1-synced ACTIVE jobs only — what ATS imports from Micro1.
 * Protected by x-sync-key. Not for the public careers website.
 */
router.get("/jobs", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);

    const filters: JobFilters = {
      source:
        typeof req.query.source === "string" ? req.query.source : undefined,
      company:
        typeof req.query.company === "string" ? req.query.company : undefined,
      employmentType:
        typeof req.query.employmentType === "string"
          ? req.query.employmentType
          : undefined,
      locationType:
        typeof req.query.locationType === "string"
          ? req.query.locationType
          : undefined,
      remote:
        typeof req.query.remote === "string"
          ? req.query.remote === "true"
          : undefined,
      search:
        typeof req.query.search === "string"
          ? req.query.search.trim()
          : undefined,
      posted:
        typeof req.query.posted === "string"
          ? Number(req.query.posted)
          : undefined,
      sort: req.query.sort === "oldest" ? "oldest" : "newest",
      // Only jobs imported via Micro1 sync (not ATS-published careers rows).
      origin: "micro1",
    };

    const result = await getJobs(filters, page, limit);

    res.status(200).json({
      success: true,
      data: result.jobs,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

/**
 * GET /api/ingest/referrals
 * Micro1 My Referrals feed for ATS /referrals:
 * Name, Date of referral, Status, Expert's work status, Applications,
 * Payout (null when not shown).
 * Protected by x-sync-key.
 */
router.get("/referrals", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);

    const result = await getReferralCandidates(page, limit);

    res.status(200).json({
      success: true,
      data: result.candidates,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

export default router;
