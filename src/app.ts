import express from "express";
import cors from "cors";

import jobsRouter from "./routes/jobs.js";
import applicationsRouter from "./routes/applications.js";
import resumesRouter from "./routes/resumes.js";
import candidatesRouter from "./routes/candidates.js";
import ingestRouter from "./routes/ingest.js";
import syncMicro1Router from "./routes/sync-micro1.js";
import integrationsAtsRouter from "./routes/integrations-ats.js";
import { isAppError } from "./errors/app-error.js";

const app = express();

app.use(cors());

app.use(
  express.json({
    limit: "20mb",
  }),
);

app.use("/api/jobs", jobsRouter);
app.use("/api/applications", applicationsRouter);
app.use("/api/resumes", resumesRouter);
app.use("/api/candidates", candidatesRouter);
app.use("/api/ingest", ingestRouter);
app.use("/api/sync/micro1", syncMicro1Router);
app.use("/integrations/ats", integrationsAtsRouter);

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (res.headersSent) {
      next(error);
      return;
    }

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
      message: "Internal server error",
    });
  },
);

export default app;
