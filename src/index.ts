#!/usr/bin/env node
import "dotenv/config";
import { createJob, listJobs, runJob, deleteJob } from "./schedules.js";
import { program } from "commander";

// ---- Top‑level "schedule" command ----
program
  .command("schedule")
  .description("Schedule management")
  // ---- subcommand: create ----
  .addCommand(
    program
      .command("create <name>")
      .description("Create a new scheduled job")
      .requiredOption("--cron <expr>", "cron expression (e.g. '0 2 * * *)")
      .requiredOption("--prompt <text>", "prompt to give the agent")
      .action((name: string, options) => {
        const id = createJob(name, options.cron, options.prompt);
        console.log(`✅ Scheduled job created:\n  id:    ${id}\n  name:  ${name}\n  cron:  ${options.cron}\n  prompt: ${options.prompt.slice(0, 60)}${options.prompt.length > 60 ? "…" : ""}`);
      })
  )
  // ---- subcommand: list ----
  .addCommand(
    program
      .command("list")
      .description("List all scheduled jobs")
      .action(() => {
        const jobs = listJobs();
        if (jobs.length === 0) {
          console.log("No scheduled jobs.");
          return;
        }
        console.log("Scheduled jobs:");
        for (const j of jobs) {
          console.log(`  • ${j.id}: ${j.name} — ${j.cron} → "${j.prompt.slice(0, 40)}${j.prompt.length > 40 ? "…" : ""}"`);
        }
      })
  )
  // ---- subcommand: run ----
  .addCommand(
    program
      .command("run <id>")
      .description("Run a scheduled job immediately")
      .action(async (id: string) => {
        const result = await runJob(id);
        if (!result) {
          console.error("Job not found or failed.");
          return;
        }
        console.log("✅ Result:", result.text ?? " (no text)");
      })
  )
  // ---- subcommand: delete ----
  .addCommand(
    program
      .command("delete <id>")
      .description("Delete a scheduled job")
      .action((id: string) => {
        const deleted = deleteJob(id);
        if (!deleted) {
          console.error("Unknown job id:", id);
          return;
        }
        console.log(`✅ Deleted scheduled job ${id}`);
      })
  );

program.parse();

