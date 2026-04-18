import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { HarnessRunReport } from "../runners/scenarioRunner";

export async function writeLatestReport(
  report: HarnessRunReport,
  artifactsDir: string,
): Promise<string> {
  const reportDirectory = path.resolve(process.cwd(), artifactsDir, "reports");
  const reportPath = path.join(reportDirectory, "latest.json");

  await mkdir(reportDirectory, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  return reportPath;
}
