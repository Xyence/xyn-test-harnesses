import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { parse } from "yaml";
import { ScenarioSchema, type ScenarioDefinition } from "./types";

const SCENARIO_DIR = path.resolve(process.cwd(), "src/scenarios");

export async function discoverScenarios(): Promise<ScenarioDefinition[]> {
  const entries = await readdir(SCENARIO_DIR, { withFileTypes: true });

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const scenarios: ScenarioDefinition[] = [];

  for (const fileName of files) {
    const filePath = path.join(SCENARIO_DIR, fileName);
    const raw = await readFile(filePath, "utf8");
    const parsedYaml = parse(raw);

    const parsedScenario = ScenarioSchema.safeParse(parsedYaml);
    if (!parsedScenario.success) {
      const details = parsedScenario.error.issues
        .map((issue) => `${issue.path.join(".") || "scenario"}: ${issue.message}`)
        .join("; ");
      throw new Error(`Invalid scenario '${fileName}': ${details}`);
    }

    scenarios.push(parsedScenario.data);
  }

  return scenarios;
}
