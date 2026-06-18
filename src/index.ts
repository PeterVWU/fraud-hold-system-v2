import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { scanAllSites } from "./scanner";
import type { Env } from "./types";

export class FraudScanWorkflow extends WorkflowEntrypoint<Env> {
  async run(event: WorkflowEvent<unknown>, step: WorkflowStep): Promise<void> {
    const scheduledTime = getScheduledTime(event);
    await step.do("scan all Magento sites", { retries: { limit: 3, delay: "30 seconds", backoff: "exponential" } }, async () => {
      await scanAllSites(this.env, scheduledTime);
    });
  }
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      env.FRAUD_SCAN_WORKFLOW.create({
        params: {
          triggeredBy: "cron",
          scheduledTime: controller.scheduledTime
        }
      })
    );
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    if (url.pathname === "/run" && request.method === "POST") {
      const configuredSecretName = env.MANUAL_RUN_TOKEN_ENV ?? "MANUAL_RUN_TOKEN";
      const expectedToken = env[configuredSecretName];
      const actualToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

      if (typeof expectedToken !== "string" || actualToken !== expectedToken) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }

      if (env.LOCAL_RUN_DIRECT === "true") {
        const stats = await scanAllSites(env, new Date());
        return Response.json({ ok: true, mode: "direct", stats });
      }

      await env.FRAUD_SCAN_WORKFLOW.create({ params: { triggeredBy: "manual" } });
      return Response.json({ ok: true, mode: "workflow" });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  }
};

function getScheduledTime(event: WorkflowEvent<unknown>): Date {
  const schedule = event.schedule as { scheduledTime?: number } | undefined;
  if (typeof schedule?.scheduledTime === "number") {
    return new Date(schedule.scheduledTime);
  }
  return new Date();
}
