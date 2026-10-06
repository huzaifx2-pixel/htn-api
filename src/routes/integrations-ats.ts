import { Router } from "express";
import { JobSource, JobStatus, Prisma } from "@prisma/client";
import prisma from "../prisma/client.js";
import { AppError, isAppError } from "../errors/app-error.js";
import { normalizeAtsRequirements } from "../lib/ats-requirements.js";
import { OrganizationRepository } from "../repositories/organization.repository.js";
import {
  JobRepository,
  toEmploymentType,
  toWorkplaceType,
} from "../repositories/job.repository.js";

const router = Router();

function readBearer(req: { headers: Record<string, unknown> }): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  return null;
}

function requireAtsIntegrationKey(
  req: import("express").Request,
  _res: import("express").Response,
  next: import("express").NextFunction,
) {
  const expected = process.env.HTN_ATS_INTEGRATION_KEY?.trim();
  if (!expected) {
    next(
      new AppError(
        "SYNC_NOT_CONFIGURED",
        "HTN_ATS_INTEGRATION_KEY is not configured",
        503,
      ),
    );
    return;
  }
  const provided = readBearer(req);
  if (!provided || provided !== expected) {
    next(new AppError("UNAUTHORIZED", "Invalid or missing integration key", 401));
    return;
  }
  next();
}

router.use(requireAtsIntegrationKey);

const orgRepo = new OrganizationRepository();
const jobRepo = new JobRepository();

/**
 * PUT /integrations/ats/jobs/:atsJobId
 * ATS publishes a job into the careers/website feed (origin=ats).
 * Separate from Micro1 ingest (origin=micro1).
 */
router.put("/jobs/:atsJobId", async (req, res) => {
  try {
    const atsJobId = String(req.params.atsJobId || "").trim();
    if (!atsJobId) {
      throw new AppError("VALIDATION_ERROR", "atsJobId is required", 400);
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      throw new AppError("VALIDATION_ERROR", "title is required", 400);
    }

    const orgName =
      typeof (body.organization as { name?: string } | undefined)?.name ===
      "string"
        ? String((body.organization as { name: string }).name)
        : typeof (body.client as { name?: string } | undefined)?.name === "string"
          ? String((body.client as { name: string }).name)
          : "Headsbase";

    const organizationId = await orgRepo.findOrCreate({ name: orgName });

    const externalId =
      (typeof body.externalId === "string" && body.externalId.trim()) ||
      atsJobId;

    const applyUrl =
      (typeof body.applyUrl === "string" && body.applyUrl) ||
      (typeof body.canonicalUrl === "string" && body.canonicalUrl) ||
      null;

    const statusRaw =
      typeof body.status === "string" ? body.status.toUpperCase() : "OPEN";
    const status =
      statusRaw === "OPEN" || statusRaw === "ACTIVE"
        ? JobStatus.ACTIVE
        : statusRaw === "CLOSED" || statusRaw === "FILLED"
          ? JobStatus.CLOSED
          : JobStatus.ON_HOLD;

    const openings =
      typeof body.openings === "number" && Number.isFinite(body.openings)
        ? Math.max(1, Math.floor(body.openings))
        : 1;

    const metadataObj =
      typeof body.metadata === "object" && body.metadata
        ? (body.metadata as Record<string, unknown>)
        : {};

    const normalized = normalizeAtsRequirements(
      body.requirements,
      typeof body.requirementsText === "string" ? body.requirementsText : null,
    );
    const fromMeta = normalizeAtsRequirements(metadataObj.atsRequirements);
    const requirementsText =
      normalized.requirementsText || fromMeta.requirementsText;
    const skillNames = uniqueMerge(
      normalized.skillNames,
      fromMeta.skillNames,
    );

    const employmentType =
      toEmploymentType(
        typeof body.employmentType === "string" ? body.employmentType : undefined,
      ) ?? null;

    let workplaceType =
      toWorkplaceType(
        typeof body.workplaceType === "string" ? body.workplaceType : undefined,
      ) ?? null;
    const remote = typeof body.remote === "boolean" ? body.remote : null;
    if (!workplaceType && remote === true) {
      workplaceType = toWorkplaceType("REMOTE") ?? null;
    }

    const metadata: Prisma.InputJsonValue = {
      origin: "ats",
      integration: "HTN_ATS",
      atsJobId,
      atsOrganizationId:
        typeof (body.organization as { id?: string } | undefined)?.id ===
        "string"
          ? (body.organization as { id: string }).id
          : null,
      syncedAt: new Date().toISOString(),
      ...metadataObj,
    };

    const existing = await prisma.job.findFirst({
      where: {
        OR: [
          { source: JobSource.MANUAL, externalId: atsJobId },
          { metadata: { path: ["atsJobId"], equals: atsJobId } },
          { source: JobSource.MICRO1, externalId },
        ],
      },
      select: { id: true },
    });

    const data = {
      title,
      description:
        typeof body.description === "string" ? body.description : null,
      summary: typeof body.summary === "string" ? body.summary : null,
      responsibilities:
        typeof body.responsibilities === "string"
          ? body.responsibilities
          : null,
      requirements: requirementsText,
      preferredQualifications:
        typeof body.preferredQualifications === "string"
          ? body.preferredQualifications
          : null,
      applyUrl,
      canonicalUrl: applyUrl,
      openings,
      status,
      employmentType,
      workplaceType,
      remote,
      location: typeof body.location === "string" ? body.location : null,
      country: typeof body.country === "string" ? body.country : null,
      city: typeof body.city === "string" ? body.city : null,
      salaryMin:
        typeof body.salaryMin === "number" ? body.salaryMin : null,
      salaryMax:
        typeof body.salaryMax === "number" ? body.salaryMax : null,
      salaryCurrency:
        typeof body.salaryCurrency === "string" ? body.salaryCurrency : null,
      postedAt:
        typeof body.postedAt === "string" ? new Date(body.postedAt) : null,
      expiresAt:
        typeof body.expiresAt === "string" ? new Date(body.expiresAt) : null,
      metadata,
      organizationId,
      lastSyncedAt: new Date(),
      lastSeenAt: new Date(),
    };

    let jobId: string;
    if (existing) {
      await prisma.job.update({
        where: { id: existing.id },
        data: {
          ...data,
          externalId,
          source: JobSource.MANUAL,
        },
      });
      jobId = existing.id;
    } else {
      const created = await prisma.job.create({
        data: {
          ...data,
          externalId,
          source: JobSource.MANUAL,
        },
      });
      jobId = created.id;
    }

    if (skillNames.length > 0) {
      await jobRepo.addSkills(prisma, jobId, skillNames);
    }

    res.status(200).json({
      success: true,
      data: { id: jobId, atsJobId, externalId, origin: "ats" },
    });
  } catch (error) {
    if (isAppError(error)) {
      res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
      });
      return;
    }
    console.error(error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

function uniqueMerge(...lists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const item of list) {
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

export default router;
