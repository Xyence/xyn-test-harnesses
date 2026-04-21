import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { parse } from "yaml";
import { ScenarioSchema, type ScenarioDefinition, type ScenarioSuite } from "./types";

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
    let parsedYaml: unknown;
    try {
      parsedYaml = parse(raw);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Scenario schema validation failure '${fileName}': invalid YAML: ${message}`);
    }

    // ScenarioSchema validates MCP-native assertions; unknown legacy fields are ignored.
    const parsedScenario = ScenarioSchema.safeParse(parsedYaml);
    if (!parsedScenario.success) {
      const details = parsedScenario.error.issues
        .map((issue) => `${issue.path.join(".") || "scenario"}: ${issue.message}`)
        .join("; ");
      throw new Error(`Scenario schema validation failure '${fileName}': ${details}`);
    }

    scenarios.push({
      ...parsedScenario.data,
      suite: parsedScenario.data.suite ?? inferScenarioSuite(parsedScenario.data.id),
    });
  }

  return scenarios;
}

function inferScenarioSuite(scenarioId: string): ScenarioSuite {
  const id = String(scenarioId || "").trim();
  const dealFinderMcpScenarioIds = new Set([
    "mcp_create_campaign",
    "mcp_add_update_datasource",
    "mcp_create_update_notification_rule",
  ]);
  const dealFinderCampaignLifecyclePrefix = "campaign_lifecycle_";
  const dealFinderNotificationLifecyclePrefix = "notification_lifecycle_";
  const dealFinderIngestOpsPrefix = "ingest_ops_";
  const dealFinderCampaignNotificationAssociationPrefix = "campaign_notification_association_";
  const dealFinderOwnerLookupPrefix = "owner_lookup_";
  const dealFinderConditionDefinitionPrefix = "condition_definition_";
  const dealFinderDataSourceCrudPrefix = "dscrud_";
  const dealFinderIngestionPrefix = "dsi_";
  if (dealFinderMcpScenarioIds.has(id)) {
    return "deal-finder-mcp";
  }
  if (id.startsWith(dealFinderDataSourceCrudPrefix)) {
    return "deal-finder-datasource-crud";
  }
  if (id.startsWith(dealFinderIngestionPrefix)) {
    return "deal-finder-ingestion-smoke";
  }
  if (id.startsWith(dealFinderCampaignLifecyclePrefix)) {
    return "deal-finder-campaign-lifecycle";
  }
  if (id.startsWith(dealFinderNotificationLifecyclePrefix)) {
    return "deal-finder-notification-lifecycle";
  }
  if (id.startsWith(dealFinderIngestOpsPrefix)) {
    return "deal-finder-ingest-ops";
  }
  if (id.startsWith(dealFinderCampaignNotificationAssociationPrefix)) {
    return "deal-finder-campaign-notification-association";
  }
  if (id.startsWith(dealFinderOwnerLookupPrefix)) {
    return "deal-finder-owner-lookup";
  }
  if (id.startsWith(dealFinderConditionDefinitionPrefix)) {
    return "deal-finder-condition-definitions";
  }
  return "planner-regression";
}
