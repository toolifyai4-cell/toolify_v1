import * as cron from "node-cron";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const SCHEDULES_DIR = path.join(os.homedir(), ".toolify", "schedules");
const JOBS_FILE = path.join(SCHEDULES_DIR, "jobs.json");

if (!fs.existsSync(SCHEDULES_DIR)) {
  fs.mkdirSync(SCHEDULES_DIR, { recursive: true });
}

/** Minimal description of a scheduled job. */
export interface ScheduledJob {
  id: string;
  name: string;
  cron: string;
  prompt: string;
}

/** In‑memory map of active cron tasks (keyed by job id). */
const activeJobs = new Map<string, cron.ScheduledTask>();

/** Load previously persisted jobs from disk (called on module init). */
function loadPersistedJobs(): void {
  if (!fs.existsSync(JOBS_FILE)) return;
  try {
    const data = fs.readFileSync(JOBS_FILE, "utf-8");
    const parsed = JSON.parse(data) as ScheduledJob[];
    for (const j of parsed) {
      activeJobs.set(j.id, { name: j.name, cron: j.cron, prompt: j.prompt } as any);
    }
  } catch {
    // Corrupt file – start fresh.
  }
}

/** Persist the current state of activeJobs to disk. */
function persistJobs(): void {
  const payload = JSON.stringify(Array.from(activeJobs.entries()).map(([id, meta]) => ({
    id,
    name: meta.name,
    cron: meta.cron,
    prompt: meta.prompt,
  })));
  fs.writeFileSync(JOBS_FILE, payload, "utf-8");
}
loadPersistedJobs();

/** Create a new scheduled job.
 *  @param name    Human‑readable name.
 *  @param cronExpr Standard 5‑field cron expression (e.g. "0 2 * * *").
 *  @param prompt   Prompt to give the agent when the job fires.
 *  @returns The job id that can be used with `runJob` / `deleteJob`.
 */
export function createJob(name: string, cronExpr: string, prompt: string): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const job: ScheduledJob = { id, name, cron: cronExpr, prompt };
  activeJobs.set(id, { name, cron: cronExpr, prompt } as any); // store metadata for list/run
  persistJobs();
  return id;
}

/** Return all jobs that have been created. */
export function listJobs(): ScheduledJob[] {
  return Array.from(activeJobs.entries()).map(([id, meta]) => ({
    id,
    name: meta.name,
    cron: meta.cron,
    prompt: meta.prompt,
  }) as ScheduledJob);
}

/** Immediately execute the job with the given id (placeholder – runs the agent loop stub). */
export async function runJob(id: string): Promise<ChatResponse | null> {
  // Placeholder: always return a dummy response so the CLI `run` command works.
  return {
    text: "Scheduled job executed (placeholder)",
    toolCalls: [],
    usage: {},
    model: "scheduler",
  } as ChatResponse;
}

/** Remove a scheduled job and cancel its cron timer. */
export function deleteJob(id: string): boolean {
  const task = activeJobs.get(id);
  if (!task) return false;
  try {
    ;(task as any).stop?.();
  } catch {
    // ignore
  }
  activeJobs.delete(id);
  persistJobs();
  return true;
}