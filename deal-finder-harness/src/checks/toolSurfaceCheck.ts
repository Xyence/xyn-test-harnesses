import type { DevelopmentRequestResult } from "../clients/mcpClient";
import type { ScenarioDefinition } from "../scenarios/types";

const REQUIRED_CAMPAIGN_TOOLS = [
  "create_campaign",
  "list_campaigns",
  "get_campaign",
  "update_campaign",
  "pause_campaign",
  "archive_campaign",
];

const REQUIRED_DATA_SOURCE_TOOLS = [
  "create_data_source",
  "list_data_sources",
  "get_data_source",
  "update_data_source",
  "activate_data_source",
  "pause_data_source",
  "delete_data_source",
];

const REQUIRED_INGESTION_TOOLS = [
  "run_data_source_ingest",
  "get_data_source_ingest_status",
  "list_data_source_runs",
  "get_data_source_quality_report",
];

const REQUIRED_NOTIFICATION_TOOLS = [
  "create_notification_rule",
  "list_notification_rules",
  "get_notification_rule",
  "update_notification_rule",
  "activate_notification_rule",
  "pause_notification_rule",
];

const REQUIRED_CAMPAIGN_NOTIFICATION_ASSOCIATION_TOOLS = [
  "add_campaign_notification_rule",
  "remove_campaign_notification_rule",
  "list_campaign_notification_rules",
];

const REQUIRED_OWNER_LOOKUP_TOOLS = [
  "resolve_parcel_by_address",
  "get_owner_snapshot_by_parcel",
  "get_property_owner_by_address",
];

const REQUIRED_CONDITION_DEFINITION_TOOLS = [
  "create_condition_definition",
  "update_condition_definition",
  "list_condition_definitions",
  "get_condition_definition",
  "activate_condition_definition",
  "pause_condition_definition",
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
    readonly forbiddenExecutionStatus: number | null;
    readonly forbiddenExecutionErrorCode: number | null;
    readonly forbiddenExecutionErrorMessage: string | null;
  };
}

export function runToolSurfaceCheck(
  scenario: ScenarioDefinition,
  developmentResult: DevelopmentRequestResult,
): ToolSurfaceCheckResult {
  const requiredToolsBySuite: Record<string, readonly string[]> = {
    "deal-finder-mcp": [...REQUIRED_CAMPAIGN_TOOLS, ...REQUIRED_DATA_SOURCE_TOOLS, ...REQUIRED_NOTIFICATION_TOOLS],
    "deal-finder-datasource-crud": REQUIRED_DATA_SOURCE_TOOLS,
    "deal-finder-ingestion-smoke": [...REQUIRED_DATA_SOURCE_TOOLS, ...REQUIRED_INGESTION_TOOLS],
    "deal-finder-campaign-lifecycle": REQUIRED_CAMPAIGN_TOOLS,
    "deal-finder-notification-lifecycle": REQUIRED_NOTIFICATION_TOOLS,
    "deal-finder-ingest-ops": [...REQUIRED_DATA_SOURCE_TOOLS, ...REQUIRED_INGESTION_TOOLS],
    "deal-finder-campaign-notification-association": [
      ...REQUIRED_CAMPAIGN_TOOLS,
      ...REQUIRED_NOTIFICATION_TOOLS,
      ...REQUIRED_CAMPAIGN_NOTIFICATION_ASSOCIATION_TOOLS,
    ],
    "deal-finder-owner-lookup": REQUIRED_OWNER_LOOKUP_TOOLS,
    "deal-finder-condition-definitions": REQUIRED_CONDITION_DEFINITION_TOOLS,
  };

  if (
    scenario.suite !== "deal-finder-mcp" &&
    scenario.suite !== "deal-finder-datasource-crud" &&
    scenario.suite !== "deal-finder-ingestion-smoke" &&
    scenario.suite !== "deal-finder-campaign-lifecycle" &&
    scenario.suite !== "deal-finder-notification-lifecycle" &&
    scenario.suite !== "deal-finder-ingest-ops" &&
    scenario.suite !== "deal-finder-campaign-notification-association" &&
    scenario.suite !== "deal-finder-owner-lookup" &&
    scenario.suite !== "deal-finder-condition-definitions"
  ) {
    return {
      passed: true,
      details: ["Tool surface check not required for this suite"],
      observed: {
        listedTools: [],
        requiredMissing: [],
        forbiddenPresent: [],
        forbiddenExecutionProbeTool: null,
        forbiddenExecutionRejected: null,
        forbiddenExecutionStatus: null,
        forbiddenExecutionErrorCode: null,
        forbiddenExecutionErrorMessage: null,
      },
    };
  }

  const listedTools = [...(developmentResult.toolSurface?.listedTools ?? [])];
  const listedSet = new Set(listedTools);
  const requiredTools = requiredToolsBySuite[scenario.suite] ?? [];
  const requiredMissing = requiredTools.filter((name) => !listedSet.has(name));
  const forbiddenPresent = FORBIDDEN_ROOT_TOOLS.filter((name) => listedSet.has(name));
  const probe = developmentResult.toolSurface?.forbiddenToolProbe ?? null;
  const forbiddenExecutionRejected = probe ? !probe.ok : null;
  const probeStatus = probe?.error?.status ?? null;
  const errorBody = asRecordOrParsedJson(probe?.error?.errorBody);
  const errorObject = asRecord(errorBody.error);
  const probeErrorCode = asNumber(errorObject.code);
  const probeErrorMessage = asString(errorObject.message);

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
    if (probeStatus !== 403) {
      passed = false;
      details.push(`forbidden tool rejection status mismatch: expected 403, got '${probeStatus ?? "null"}'`);
    }
    if (probeErrorCode !== -32001 || probeErrorMessage !== "tool_not_allowed_for_binding") {
      passed = false;
      details.push(
        `forbidden tool rejection payload mismatch: expected code=-32001 and message='tool_not_allowed_for_binding', got code='${probeErrorCode ?? "null"}' message='${probeErrorMessage ?? "null"}'`,
      );
    }
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
      forbiddenExecutionStatus: probeStatus,
      forbiddenExecutionErrorCode: probeErrorCode,
      forbiddenExecutionErrorMessage: probeErrorMessage,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asRecordOrParsedJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function asString(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}
