import test from "node:test";
import assert from "node:assert/strict";
import { runToolSurfaceCheck } from "../checks/toolSurfaceCheck";
import type { DevelopmentRequestResult } from "../clients/mcpClient";
import type { ScenarioDefinition } from "../scenarios/types";

const FULL_DEAL_FINDER_TOOL_SURFACE = [
  "create_campaign",
  "list_campaigns",
  "get_campaign",
  "update_campaign",
  "pause_campaign",
  "archive_campaign",
  "create_data_source",
  "list_data_sources",
  "get_data_source",
  "update_data_source",
  "activate_data_source",
  "pause_data_source",
  "delete_data_source",
  "run_data_source_ingest",
  "get_data_source_ingest_status",
  "list_data_source_runs",
  "get_data_source_quality_report",
  "create_notification_rule",
  "list_notification_rules",
  "get_notification_rule",
  "update_notification_rule",
  "activate_notification_rule",
  "pause_notification_rule",
  "add_campaign_notification_rule",
  "remove_campaign_notification_rule",
  "list_campaign_notification_rules",
  "resolve_parcel_by_address",
  "get_owner_snapshot_by_parcel",
  "get_property_owner_by_address",
  "create_condition_definition",
  "update_condition_definition",
  "list_condition_definitions",
  "get_condition_definition",
  "activate_condition_definition",
  "pause_condition_definition",
];

function buildScenario(): ScenarioDefinition {
  return {
    id: "tool-surface",
    suite: "deal-finder-mcp",
    title: "Tool surface isolation",
    request: "Create campaign",
    expected_artifacts: ["deal-finder"],
    expected_primary_artifact: "deal-finder",
    optional_artifacts: [],
    forbidden_artifacts: [],
    hard_forbidden_artifacts: [],
    hard_required_artifacts: [],
    target_source_files: [],
    accepted_dependency_reasons: [],
    planner_expectations: {
      should_use_mcp: true,
      may_require_core_xyn_changes: false,
      success_criteria: ["deal finder flow"],
      required_phrases: [],
      forbidden_phrases: [],
    },
    deployment: {
      mode: "preview",
      requires_xyn_api: false,
      require_branch_isolation: false,
    },
    assertions: {
      expected_operations: [],
      expected_entities_created: [],
      expected_entities_updated: [],
      expected_response_fields: [],
      expected_notifications: [],
      require_sibling_metadata: false,
      require_url_check: false,
    },
  };
}

function buildResult(listedTools: string[], forbiddenRejected: boolean): DevelopmentRequestResult {
  return {
    requestText: "Create campaign",
    selectedArtifacts: ["deal-finder"],
    initialSuggestedArtifacts: ["deal-finder"],
    finalSelectedArtifacts: ["deal-finder"],
    primaryArtifact: "deal-finder",
    dependentArtifacts: [],
    artifactDetails: [],
    plannerPlan: {},
    siblingId: "s1",
    siblingUrl: "https://example.test",
    branchName: null,
    toolSurface: {
      listedTools,
      forbiddenToolProbe: {
        toolName: "list_applications",
        ok: !forbiddenRejected,
        error: forbiddenRejected
          ? {
              message: "MCP tool blocked",
              status: 403,
              errorBody: {
                error: {
                  code: -32001,
                  message: "tool_not_allowed_for_binding",
                },
              },
            }
          : null,
      },
    },
    rawResponses: {
      submitRequest: {},
      artifactSelection: {},
      plannerOutput: {},
      siblingInfo: {},
      siblingUrl: {},
      branchInfo: {},
    },
  };
}

test("passes when deal finder tools are present and root tool probe is rejected", () => {
  const result = runToolSurfaceCheck(
    buildScenario(),
    buildResult(FULL_DEAL_FINDER_TOOL_SURFACE, true),
  );
  assert.equal(result.passed, true, result.details.join("\n"));
});

test("fails when root tools are discoverable", () => {
  const result = runToolSurfaceCheck(
    buildScenario(),
    buildResult(
      [
        ...FULL_DEAL_FINDER_TOOL_SURFACE,
        "list_applications",
      ],
      true,
    ),
  );
  assert.equal(result.passed, false);
  assert.ok(result.observed.forbiddenPresent.includes("list_applications"));
});

test("fails when forbidden execution rejection shape is not structured as expected", () => {
  const result = runToolSurfaceCheck(buildScenario(), {
    ...buildResult(FULL_DEAL_FINDER_TOOL_SURFACE, true),
    toolSurface: {
      listedTools: FULL_DEAL_FINDER_TOOL_SURFACE,
      forbiddenToolProbe: {
        toolName: "list_applications",
        ok: false,
        error: {
          message: "wrong payload shape",
          status: 400,
          errorBody: {
            error: {
              code: -32600,
              message: "Bad Request",
            },
          },
        },
      },
    },
  });
  assert.equal(result.passed, false);
  assert.equal(result.observed.forbiddenExecutionStatus, 400);
  assert.equal(result.observed.forbiddenExecutionErrorCode, -32600);
});
