import test from "node:test";
import assert from "node:assert/strict";
import { runToolSurfaceCheck } from "../checks/toolSurfaceCheck";
import type { DevelopmentRequestResult } from "../clients/mcpClient";
import type { ScenarioDefinition } from "../scenarios/types";

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
        error: forbiddenRejected ? "blocked" : null,
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
    buildResult(
      [
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
      ],
      true,
    ),
  );
  assert.equal(result.passed, true, result.details.join("\n"));
});

test("fails when root tools are discoverable", () => {
  const result = runToolSurfaceCheck(
    buildScenario(),
    buildResult(
      [
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
        "list_applications",
      ],
      true,
    ),
  );
  assert.equal(result.passed, false);
  assert.ok(result.observed.forbiddenPresent.includes("list_applications"));
});
