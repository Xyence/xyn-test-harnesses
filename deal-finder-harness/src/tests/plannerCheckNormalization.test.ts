import test from "node:test";
import assert from "node:assert/strict";
import { runPlannerCheck } from "../checks/plannerCheck";
import type { ScenarioDefinition } from "../scenarios/types";
import type { DevelopmentRequestResult } from "../clients/mcpClient";

function scenarioWithRequiredPhrases(requiredPhrases: string[]): ScenarioDefinition {
  return {
    id: "planner-check-normalization",
    suite: "planner-regression",
    title: "Planner check normalization",
    request: "Update UI copy and keep scope frontend only",
    expected_artifacts: ["xyn-ui"],
    expected_primary_artifact: "xyn-ui",
    optional_artifacts: [],
    forbidden_artifacts: ["xyn-api"],
    hard_forbidden_artifacts: [],
    hard_required_artifacts: [],
    target_source_files: [],
    accepted_dependency_reasons: [],
    planner_expectations: {
      should_use_mcp: true,
      may_require_core_xyn_changes: false,
      success_criteria: ["ui scope"],
      required_phrases: requiredPhrases,
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

function resultWithPlannerText(plannerText: string): DevelopmentRequestResult {
  return {
    requestText: "Update UI copy and keep scope frontend only",
    selectedArtifacts: ["xyn-ui"],
    initialSuggestedArtifacts: ["xyn-ui"],
    finalSelectedArtifacts: ["xyn-ui"],
    primaryArtifact: "xyn-ui",
    dependentArtifacts: [],
    artifactDetails: [],
    plannerPlan: {
      summary: plannerText,
      implementation_steps: ["Update UI command palette copy"],
      validation_plan: ["Validate command lookup in UI"],
    },
    siblingId: "s1",
    siblingUrl: "http://example",
    branchName: "change-session/s1",
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

test("required phrase 'discoverable' matches semantic equivalent wording", () => {
  const scenario = scenarioWithRequiredPhrases(["command palette", "discoverable"]);
  const result = runPlannerCheck(
    scenario,
    resultWithPlannerText("Update command palette text so Deal Finder is searchable and easier to find."),
  );
  assert.ok(!result.observed.missingRequiredPhrases.includes("discoverable"), result.details.join("\n"));
});

test("required phrase 'ui only' passes for frontend scope without API terms", () => {
  const scenario = scenarioWithRequiredPhrases(["ui only"]);
  const result = runPlannerCheck(
    scenario,
    resultWithPlannerText("Limit the work to frontend workbench wording and validation checks."),
  );
  assert.ok(!result.observed.missingRequiredPhrases.includes("ui only"), result.details.join("\n"));
});

test("required phrase 'ui only' fails when planner includes backend/API scope", () => {
  const scenario = scenarioWithRequiredPhrases(["ui only"]);
  const result = runPlannerCheck(
    scenario,
    resultWithPlannerText("Update frontend wording and add backend API contract updates."),
  );
  assert.equal(result.passed, false);
  assert.ok(result.observed.missingRequiredPhrases.includes("ui only"));
});
