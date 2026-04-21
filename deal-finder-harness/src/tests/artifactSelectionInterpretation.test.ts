import test from "node:test";
import assert from "node:assert/strict";
import { resolveArtifactSelectionForAssertions, type DevelopmentRequestResult } from "../clients/mcpClient";
import { runArtifactSelectionCheck } from "../checks/artifactSelectionCheck";
import type { ScenarioDefinition } from "../scenarios/types";

function baseScenario(): ScenarioDefinition {
  return {
    id: "planner-backend-refactor-xyn-api-path-no-ui",
    suite: "planner-regression",
    title: "Planner Regression",
    request: "Refactor backend only",
    expected_artifacts: ["xyn-api"],
    expected_primary_artifact: "xyn-api",
    optional_artifacts: [],
    forbidden_artifacts: ["xyn-ui"],
    hard_forbidden_artifacts: ["xyn-ui"],
    hard_required_artifacts: ["xyn-api"],
    target_source_files: [],
    accepted_dependency_reasons: [],
    planner_expectations: {
      should_use_mcp: true,
      may_require_core_xyn_changes: false,
      success_criteria: ["Backend-only plan"],
      required_phrases: [],
      forbidden_phrases: [],
    },
    deployment: {
      mode: "preview",
      requires_xyn_api: true,
      require_branch_isolation: true,
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

function baseResult(args: {
  selectedArtifacts: string[];
  initialSuggestedArtifacts: string[];
  finalSelectedArtifacts: string[];
  primaryArtifact?: string;
}): DevelopmentRequestResult {
  return {
    requestText: "Refactor backend only",
    selectedArtifacts: args.selectedArtifacts,
    initialSuggestedArtifacts: args.initialSuggestedArtifacts,
    finalSelectedArtifacts: args.finalSelectedArtifacts,
    primaryArtifact: args.primaryArtifact ?? "xyn-api",
    dependentArtifacts: args.finalSelectedArtifacts.filter((artifact) => artifact !== (args.primaryArtifact ?? "xyn-api")),
    artifactDetails: [],
    plannerPlan: { kind: "draft_plan" },
    siblingId: "sib-1",
    siblingUrl: "http://xyn-local-api:8000",
    branchName: "change-session/sib-1",
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

test("resolveArtifactSelectionForAssertions prefers finalized planner/session selection over initial suggestions", () => {
  const initialCreateSession = {
    response: {
      raw: {
        session: {
          selected_artifacts: [
            { artifact_id: "id-api", artifact_title: "xyn-api" },
            { artifact_id: "id-ui", artifact_title: "xyn-ui" },
          ],
        },
      },
    },
  };
  const finalPlanResponse = {
    response: {
      raw: {
        session: {
          selected_artifact_ids: ["id-api"],
          primary_artifact_id: "id-api",
          dependent_artifact_ids: [],
        },
      },
    },
  };
  const resolved = resolveArtifactSelectionForAssertions({
    artifactDetails: [],
    initialSources: [initialCreateSession],
    finalSources: [finalPlanResponse, initialCreateSession],
    primaryArtifactSources: [finalPlanResponse, initialCreateSession],
    dependentArtifactSources: [finalPlanResponse, initialCreateSession],
  });
  assert.deepEqual(resolved.initialSuggestedArtifacts, ["xyn-api", "xyn-ui"]);
  assert.deepEqual(resolved.finalSelectedArtifacts, ["xyn-api"]);
  assert.equal(resolved.primaryArtifact, "xyn-api");
  assert.deepEqual(resolved.dependentArtifacts, []);
});

test("artifact selection check passes when final artifacts satisfy constraints even if initial suggestions were broader", () => {
  const scenario = baseScenario();
  const developmentResult = baseResult({
    selectedArtifacts: ["xyn-api"],
    initialSuggestedArtifacts: ["xyn-api", "xyn-ui"],
    finalSelectedArtifacts: ["xyn-api"],
  });
  const result = runArtifactSelectionCheck(scenario, developmentResult);
  assert.equal(result.passed, true);
  assert.deepEqual(result.observed.initialSuggestedArtifacts, ["xyn-api", "xyn-ui"]);
  assert.deepEqual(result.observed.finalSelectedArtifacts, ["xyn-api"]);
});

test("artifact selection check fails when finalized artifact scope violates forbidden constraints", () => {
  const scenario = baseScenario();
  const developmentResult = baseResult({
    selectedArtifacts: ["xyn-api", "xyn-ui"],
    initialSuggestedArtifacts: ["xyn-api", "xyn-ui"],
    finalSelectedArtifacts: ["xyn-api", "xyn-ui"],
  });
  const result = runArtifactSelectionCheck(scenario, developmentResult);
  assert.equal(result.passed, false);
  assert.deepEqual(result.observed.presentForbiddenArtifacts, ["xyn-ui"]);
});
