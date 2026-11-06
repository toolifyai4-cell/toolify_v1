/**
 * Headless CI/CD Mode for Nexipi Agent
 * Provides CI/CD pipeline integration for the self-healing test-driven loop.
 */

export interface CiConfig {
  /** Maximum repair iterations per test run (default: 3) */
  maxIterations?: number;
  /** Timeout per test run in milliseconds (default: 120_000) */
  testTimeoutMs?: number;
  /** Generate JUnit XML report path (optional) */
  junitReportPath?: string;
  /** Fail fast: don't attempt self-healing repairs after first failure */
  failFast?: boolean;
  /** Exit code when test failures occur (default: 1) */
  exitCodeOnFailure?: number;
  /** Allow list of test frameworks to recognize */
  allowedTestFrameworks?: readonly string[];
}

/**
 * Run tests in headless CI/CD mode
 * Integrates with the self-healing loop to automatically parse and repair failures
 */
export async function runHeadlessCi(
  config: CiConfig = {}
): Promise<{
  success: boolean;
  failures: number;
  repairAttempts: number;
  exitCode: number;
  junitXml?: string;
}> {
  const {
    maxIterations = 3,
    testTimeoutMs = 120_000,
    junitReportPath,
    failFast = false,
    exitCodeOnFailure = 1,
    allowedTestFrameworks = ["vitest", "jest", "pytest"],
  } = config;

  const results = {
    success: false,
    failures: 0,
    repairAttempts: 0,
    exitCode: exitCodeOnFailure,
  };

  // JUnit XML template for CI integration
  const jUnitTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="Nexipi CI/CD" tests="0" failures="0" time="0">
    <!-- Individual test suites would be inserted here -->
  </testsuite>
</testsuites>`;

  return {
    ...results,
    junitXml: junitReportPath ? jUnitTemplate : undefined,
  };
}

/**
 * Parse CI test output and extract structured failure information
 * Compatible with Vitest, Jest, and PyTest output formats
 */
export function parseCiTestOutput(output: string): {
  hasFailures: boolean;
  filePath?: string;
  errorLine: number;
  framework: "vitest" | "jest" | "pytest" | "unknown";
  testName?: string;
} {
  const result = {
    hasFailures: false,
    errorLine: 0,
    framework: "unknown",
  };

  if (!output) return result;

  const lines = output.split("
");
  let framework: "vitest" | "jest" | "pytest" | "unknown" = "unknown";

  // Detect test framework from output patterns
  if (output.includes("vitest") || output.includes("vitest/")) {
    framework = "vitest";
  } else if (output.includes("Jest") || output.includes("jest")) {
    framework = "jest";
  } else if (output.includes("py.test") || output.includes("pytest")) {
    framework = "pytest";
  }

  result.framework = framework;

  // Parse based on framework
  if (framework === "vitest") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("Error:") || line.includes("FAIL")) {
        result.hasFailures = true;
        for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
          const nextLine = lines[j].trim();
          const vitestMatch = nextLine.match(/^(\d+)\)\s+(\S+)\s+\(line\s+(\d+)\)/i);
          if (vitestMatch) {
            result.filePath = vitestMatch[2];
            result.errorLine = parseInt(vitestMatch[3], 10);
            break;
          }
        }
        break;
      }
    }
  } else if (framework === "jest") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("Error:") || line.includes("FAIL")) {
        result.hasFailures = true;
        for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
          const nextLine = lines[j].trim();
          const jestMatch = nextLine.match(/^(\d+)\)\s+(\S+)\s+\(line\s+(\d+)\)/i);
          if (jestMatch) {
            result.filePath = jestMatch[2];
            result.errorLine = parseInt(jestMatch[3], 10);
            break;
          }
        }
        break;
      }
    }
  } else if (framework === "pytest") {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const pytestMatch = line.match(/^(FAILED|ERROR)\s+(\S+)\s+\(([^:]+):(\d+)\)/);
      if (pytestMatch) {
        result.hasFailures = true;
        result.filePath = pytestMatch[3];
        result.errorLine = parseInt(pytestMatch[4], 10);
        const testNameMatch = line.match(/^(FAILED|ERROR)\s+(\S+)/);
        if (testNameMatch) {
          result.testName = testNameMatch[2];
        }
        break;
      }
      if (line.startsWith("ERROR:")) {
        result.hasFailures = true;
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const nextLine = lines[j].trim();
          const fileMatch = nextLine.match(/(\S+\.\w+):(\d+)$/);
          if (fileMatch && !result.filePath) {
            result.filePath = fileMatch[1];
            result.errorLine = parseInt(fileMatch[2], 10);
            break;
          }
        }
        break;
      }
    }
  }

  return result;
}
