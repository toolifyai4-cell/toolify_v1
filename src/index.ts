#!/usr/bin/env node
import "dotenv/config";
import { buildProgram } from "./cli/run.js";

buildProgram()
  .parseAsync(process.argv)
  .catch((err) => {
    console.error(`toolify: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });

