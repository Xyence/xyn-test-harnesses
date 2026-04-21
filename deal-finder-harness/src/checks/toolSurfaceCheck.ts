import type { DevelopmentRequestResult } from "../clients/mcpClient";
import type { ScenarioDefinition } from "../scenarios/types";

const REQUIRED_DEAL_FINDER_TOOLS = [
  "create_campaign",
  "update_campaign",
  "create_data_source",
  "list_data_sources",
  "get_data_source",
  "update_data_source",
  "activate_data_source",
  "pause_data_source",
  "delete_data_source",
  "create_notification_rule",
  "update_notification_rule",
];

const FORBIDDEN_ROOT_TOOLS = [
  "list_applications",
  "get_application",
  "list_application_change_sessions",
  "create_application_change_session",
  "get_application_change_session",
];

export interface ToolSurfaceCheckResult {
  readonly passed: boolean;
  readonly details: string[];
  readonly observed: {
    readonly listedTools: readonly string[];
    readonly requiredMissing: readonly string[];
    readonly forbiddenPresent: readonly string[];
    readonly forbiddenExecutionProbeTool: string | null;
    readonly forbiddenExecutionRejected: boolean | null;
  };
}

export function runToolSurfaceCheck(
  scenario: ScenarioDefinition,
  developmentResult: DevelopmentRequestResult,
): ToolSurfaceCheckResult {
  if (scenario.suite !== "deal-finder-mcp" && scenario.suite !== "deal-finder-datasource-crud") {
    return {
      passed: true,
      details: ["Tool surface check not required for this suite"],
      observed: {
        listedTools: [],
        requiredMissing: [],
        forbiddenPresent: [],
        forbiddenExecutionProbeTool: null,
        forbiddenExecutionRejected: null,
      },
    };
  }

  const listedTools = [...(developmentResult.toolSurface?.listedTools ?? [])];
  const listedSet = new Set(listedTools);
  const requiredMissing = REQUIRED_DEAL_FINDER_TOOLS.filter((name) => !listedSet.has(name));
  const forbiddenPresent = FORBIDDEN_ROOT_TOOLS.filter((name) => listedSet.has(name));
  const probe = developmentResult.toolSurface?.forbiddenToolProbe ?? null;
  const forbiddenExecutionRejected = probe ? !probe.ok : null;

  let passed = true;
  const details: string[] = [];

  if (requiredMissing.length > 0) {
    passed = false;
    details.push(`missing required Deal Finder tools: ${requiredMissing.join(", ")}`);
  } else {
    details.push("required Deal Finder tools are discoverable");
  }

  if (forbiddenPresent.length > 0) {
    passed = false;
    details.push(`forbidden root tools are visible: ${forbiddenPresent.join(", ")}`);
  } else {
    details.push("forbidden root tools are absent from discovery");
  }

  if (!probe) {
    passed = false;
    details.push("forbidden tool execution probe is missing");
  } else if (probe.ok) {
    passed = false;
    details.push(`forbidden tool execution probe unexpectedly succeeded for '${probe.toolName}'`);
  } else {
    details.push(`forbidden tool execution probe was rejected for '${probe.toolName}'`);
  }

  return {
    passed,
    details,
    observed: {
      listedTools,
      requiredMissing,
      forbiddenPresent,
      forbiddenExecutionProbeTool: probe?.toolName ?? null,
      forbiddenExecutionRejected,
    },
  };
}
