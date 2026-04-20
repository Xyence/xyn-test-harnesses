import fs from "node:fs/promises";
import path from "node:path";
import type { AuthProvider } from "../auth/authProvider";
import type { McpClient } from "../clients/mcpClient";
import { runArtifactSelectionCheck, type ArtifactSelectionCheckResult } from "../checks/artifactSelectionCheck";
import {
  buildIntentKeywords,
  normalizeText,
  runPlannerCheck,
  type PlannerCheckResult,
} from "../checks/plannerCheck";
import { runSiblingCheck, type SiblingCheckResult } from "../checks/siblingCheck";
import { runUrlCheck, type UrlCheckResult } from "../checks/urlCheck";
import { runCampaignMcpCheck } from "../checks/campaignMcpCheck";
import { runDataSourceMcpCheck } from "../checks/dataSourceMcpCheck";
import { runNotificationMcpCheck } from "../checks/notificationMcpCheck";
import { runResponseFieldCheck } from "../checks/responseFieldCheck";
import type { McpAssertionCheckResult } from "../checks/mcpAssertionTypes";
import type { ScenarioDefinition } from "../scenarios/types";

export interface ScenarioRunResult {
  readonly scenarioId: string;
  readonly title: string;
  readonly passed: boolean;
  readonly startedAtIso: string;
  readonly endedAtIso: string;
  readonly mcpDetails: string;
  readonly blockedReason: string | null;
  readonly failureCategory:
    | "mcp_request_failure"
    | "planner_mismatch"
    | "artifact_mismatch"
    | "blocked_scenario"
    | "entity_assertion_failure"
    | "sibling_mismatch"
    | "url_mismatch"
    | null;
  readonly artifactSelectionCheck: ArtifactSelectionCheckResult;
  readonly plannerCheck: PlannerCheckResult;
  readonly siblingCheck: SiblingCheckResult;
  readonly urlCheck: UrlCheckResult;
  readonly assertionChecks: {
    readonly campaign: McpAssertionCheckResult;
    readonly dataSource: McpAssertionCheckResult;
    readonly notification: McpAssertionCheckResult;
    readonly responseField: McpAssertionCheckResult;
  };
}

export interface ArtifactSelectionDifferenceViolation {
  readonly differGroup: string;
  readonly artifactSet: readonly string[];
  readonly scenarioIds: readonly string[];
}

export interface CannedPlanViolation {
  readonly scenarioIdA: string;
  readonly scenarioIdB: string;
  readonly similarity: number;
}

export interface HarnessRunReport {
  readonly generatedAtIso: string;
  readonly summary: {
    readonly totalScenarios: number;
    readonly passedScenarios: number;
    readonly failedScenarios: number;
    readonly blockedScenarios: number;
    readonly artifactMismatches: number;
    readonly plannerMismatches: number;
    readonly entityAssertionMismatches: number;
    readonly artifactSelectionDifferenceViolations: number;
    readonly cannedPlanViolations: number;
  };
  readonly artifactSelectionDifferenceViolations: readonly ArtifactSelectionDifferenceViolation[];
  readonly cannedPlanViolations: readonly CannedPlanViolation[];
  readonly scenarios: readonly ScenarioRunResult[];
}

interface ScenarioRunnerDependencies {
  readonly authProvider: AuthProvider;
  readonly mcpClient: McpClient;
  readonly configuredTokenMode: "access_token" | "id_token";
  readonly artifactsDir: string;
}

const MISSING_DEVELOPMENT_RESULT_ARTIFACT_CHECK: ArtifactSelectionCheckResult = {
  passed: false,
  details: ["MCP development result is missing; cannot validate artifact selection"],
  observed: {
    selectedArtifacts: [],
    requiredArtifacts: [],
    forbiddenArtifacts: [],
    optionalArtifacts: [],
    acceptedDependencyReasons: [],
    expectedPrimaryArtifact: "",
    observedPrimaryArtifact: "",
    artifactDetails: [],
    missingRequiredArtifacts: [],
    presentForbiddenArtifacts: [],
    unexpectedArtifacts: [],
    unexpectedArtifactsAllowedByDependencyReason: [],
    unexpectedArtifactsRejected: [],
  },
};

const MISSING_DEVELOPMENT_RESULT_PLANNER_CHECK: PlannerCheckResult = {
  passed: false,
  details: ["MCP development result is missing; cannot validate planner coherence"],
  observed: {
    plannerText: "",
    normalizedPlannerText: "",
    requiredPhrases: [],
    forbiddenPhrases: [],
    missingRequiredPhrases: [],
    presentForbiddenPhrases: [],
    requestIntentKeywords: [],
    matchedIntentKeywords: [],
    selectedArtifacts: [],
    missingSelectedArtifactReferences: [],
    widenedDependencies: [],
    widenedDependencyJustificationsMissing: [],
    hasImplementationSteps: false,
    hasValidationSteps: false,
  },
};

const SKIPPED_SIBLING_CHECK: SiblingCheckResult = {
  passed: true,
  details: ["Sibling check not requested by scenario"],
  observed: {
    siblingId: null,
    siblingUrl: null,
    branchName: null,
    requireBranchIsolation: false,
    missingFields: [],
  },
};

const SKIPPED_URL_CHECK: UrlCheckResult = {
  passed: true,
  details: ["URL check not requested by scenario"],
  observed: {
    url: "",
    startedAtIso: new Date(0).toISOString(),
    endedAtIso: new Date(0).toISOString(),
    totalDurationMs: 0,
    timeoutMs: 0,
    intervalMs: 0,
    attempts: [],
    finalStatusCode: null,
  },
};

const EMPTY_ASSERTION_CHECK: McpAssertionCheckResult = {
  passed: true,
  details: ["No MCP assertions expected for this check"],
  observed: {},
};

export class ScenarioRunner {
  constructor(private readonly deps: ScenarioRunnerDependencies) {}

  async runSequentially(scenarios: readonly ScenarioDefinition[]): Promise<HarnessRunReport> {
    const authSession = await this.deps.authProvider.getSession();
    const scenarioResults: ScenarioRunResult[] = [];

    for (const scenario of scenarios) {
      const startedAtIso = new Date().toISOString();
      const mcpResult = await this.deps.mcpClient.planScenario(scenario);

      if (!mcpResult.ok || !mcpResult.developmentResult) {
        console.error("MCP planning failed", {
          scenarioId: scenario.id,
          endpoint: mcpResult.httpFailure?.endpoint ?? null,
          httpStatus: mcpResult.httpFailure?.status ?? null,
          errorBody: mcpResult.httpFailure?.errorBody ?? null,
          tokenMode: this.deps.configuredTokenMode,
          tokenType: authSession.tokenType,
          audience: authSession.audience,
        });

        scenarioResults.push({
          scenarioId: scenario.id,
          title: scenario.title,
          passed: false,
          startedAtIso,
          endedAtIso: new Date().toISOString(),
          mcpDetails: `mcp_request_failure: ${mcpResult.details}`,
          blockedReason: null,
          failureCategory: "mcp_request_failure",
          artifactSelectionCheck: MISSING_DEVELOPMENT_RESULT_ARTIFACT_CHECK,
          plannerCheck: MISSING_DEVELOPMENT_RESULT_PLANNER_CHECK,
          siblingCheck: SKIPPED_SIBLING_CHECK,
          urlCheck: SKIPPED_URL_CHECK,
          assertionChecks: {
            campaign: EMPTY_ASSERTION_CHECK,
            dataSource: EMPTY_ASSERTION_CHECK,
            notification: EMPTY_ASSERTION_CHECK,
            responseField: EMPTY_ASSERTION_CHECK,
          },
        });
        continue;
      }

      await writeMcpRawResponseSnapshot(this.deps.artifactsDir, scenario.id, mcpResult.developmentResult.rawResponses);

      if (mcpResult.requiresCoreXynChanges) {
        const blockedReason =
          "blocked: scenario requires out-of-band core Xyn setup, which this MCP-native harness does not execute.";

        scenarioResults.push({
          scenarioId: scenario.id,
          title: scenario.title,
          passed: false,
          startedAtIso,
          endedAtIso: new Date().toISOString(),
          mcpDetails: `blocked_scenario: ${mcpResult.details}; ${blockedReason}`,
          blockedReason,
          failureCategory: "blocked_scenario",
          artifactSelectionCheck: runArtifactSelectionCheck(scenario, mcpResult.developmentResult),
          plannerCheck: runPlannerCheck(scenario, mcpResult.developmentResult),
          siblingCheck: SKIPPED_SIBLING_CHECK,
          urlCheck: SKIPPED_URL_CHECK,
          assertionChecks: {
            campaign: EMPTY_ASSERTION_CHECK,
            dataSource: EMPTY_ASSERTION_CHECK,
            notification: EMPTY_ASSERTION_CHECK,
            responseField: EMPTY_ASSERTION_CHECK,
          },
        });
        continue;
      }

      console.log("MCP planning succeeded", {
        scenarioId: scenario.id,
        selectedArtifacts: mcpResult.developmentResult.selectedArtifacts,
        primaryArtifact: mcpResult.developmentResult.primaryArtifact,
        siblingId: mcpResult.developmentResult.siblingId,
        siblingUrl: mcpResult.developmentResult.siblingUrl,
      });

      const artifactSelectionCheck = runArtifactSelectionCheck(scenario, mcpResult.developmentResult);
      const plannerCheck = runPlannerCheck(scenario, mcpResult.developmentResult);
      const shouldRunSiblingCheck =
        scenario.assertions.require_sibling_metadata || scenario.deployment.require_branch_isolation;
      const shouldRunUrlCheck = scenario.assertions.require_url_check;

      const siblingCheck = shouldRunSiblingCheck
        ? runSiblingCheck(scenario, mcpResult.developmentResult)
        : SKIPPED_SIBLING_CHECK;
      const urlCheck = shouldRunUrlCheck
        ? await runUrlCheck(mcpResult.developmentResult.siblingUrl)
        : SKIPPED_URL_CHECK;

      const campaignCheck = runCampaignMcpCheck(scenario, mcpResult.developmentResult);
      const dataSourceCheck = runDataSourceMcpCheck(scenario, mcpResult.developmentResult);
      const notificationCheck = runNotificationMcpCheck(scenario, mcpResult.developmentResult);
      const responseFieldCheck = runResponseFieldCheck(scenario, mcpResult.developmentResult);

      const assertionPassed =
        campaignCheck.passed && dataSourceCheck.passed && notificationCheck.passed && responseFieldCheck.passed;

      const scenarioPassed =
        artifactSelectionCheck.passed &&
        plannerCheck.passed &&
        siblingCheck.passed &&
        urlCheck.passed &&
        assertionPassed;

      const failureCategory = scenarioPassed
        ? null
        : classifyFailureCategory({
            artifactSelectionPassed: artifactSelectionCheck.passed,
            plannerPassed: plannerCheck.passed,
            siblingPassed: siblingCheck.passed,
            urlPassed: urlCheck.passed,
            assertionPassed,
          });

      scenarioResults.push({
        scenarioId: scenario.id,
        title: scenario.title,
        passed: scenarioPassed,
        startedAtIso,
        endedAtIso: new Date().toISOString(),
        mcpDetails: scenarioPassed ? mcpResult.details : `${failureCategory}: ${mcpResult.details}`,
        blockedReason: null,
        failureCategory,
        artifactSelectionCheck,
        plannerCheck,
        siblingCheck,
        urlCheck,
        assertionChecks: {
          campaign: campaignCheck,
          dataSource: dataSourceCheck,
          notification: notificationCheck,
          responseField: responseFieldCheck,
        },
      });
    }

    const differenceViolations = computeArtifactSelectionDifferenceViolations(scenarios, scenarioResults);
    const cannedPlanViolations = computeCannedPlanViolations(scenarios, scenarioResults);
    const cannedViolationIds = new Set(
      cannedPlanViolations.flatMap((violation) => [violation.scenarioIdA, violation.scenarioIdB]),
    );

    const resultsWithCannedEnforcement = scenarioResults.map((result) => {
      if (!cannedViolationIds.has(result.scenarioId)) {
        return result;
      }
      return {
        ...result,
        passed: false,
        failureCategory: result.failureCategory ?? "planner_mismatch",
        mcpDetails: `${result.mcpDetails}; planner_mismatch: canned-plan detector violation`,
      };
    });

    const passedScenarios = resultsWithCannedEnforcement.filter((result) => result.passed).length;
    const blockedScenarios = resultsWithCannedEnforcement.filter((result) => result.blockedReason !== null).length;
    const artifactMismatches = resultsWithCannedEnforcement.filter(
      (result) => result.failureCategory === "artifact_mismatch",
    ).length;
    const plannerMismatches = resultsWithCannedEnforcement.filter(
      (result) => result.failureCategory === "planner_mismatch",
    ).length;
    const entityAssertionMismatches = resultsWithCannedEnforcement.filter(
      (result) => result.failureCategory === "entity_assertion_failure",
    ).length;

    return {
      generatedAtIso: new Date().toISOString(),
      summary: {
        totalScenarios: resultsWithCannedEnforcement.length,
        passedScenarios,
        failedScenarios: resultsWithCannedEnforcement.length - passedScenarios,
        blockedScenarios,
        artifactMismatches,
        plannerMismatches,
        entityAssertionMismatches,
        artifactSelectionDifferenceViolations: differenceViolations.length,
        cannedPlanViolations: cannedPlanViolations.length,
      },
      artifactSelectionDifferenceViolations: differenceViolations,
      cannedPlanViolations,
      scenarios: resultsWithCannedEnforcement,
    };
  }
}

async function writeMcpRawResponseSnapshot(
  artifactsDir: string,
  scenarioId: string,
  rawResponses: unknown,
): Promise<void> {
  const safeScenarioId = scenarioId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const outputDir = path.resolve(process.cwd(), artifactsDir, "reports", "mcp-raw");
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.resolve(outputDir, `${safeScenarioId}.json`);
  await fs.writeFile(outputPath, `${JSON.stringify(rawResponses, null, 2)}\n`, "utf8");
}

function computeArtifactSelectionDifferenceViolations(
  scenarios: readonly ScenarioDefinition[],
  results: readonly ScenarioRunResult[],
): ArtifactSelectionDifferenceViolation[] {
  const scenarioById = new Map<string, ScenarioDefinition>(scenarios.map((scenario) => [scenario.id, scenario]));
  const grouped = new Map<string, Array<{ scenarioId: string; artifactSet: readonly string[] }>>();

  for (const result of results) {
    const scenario = scenarioById.get(result.scenarioId);
    if (!scenario?.artifact_selection_differ_group) {
      continue;
    }

    const artifactSet = normalizeArtifactSet(result.artifactSelectionCheck.observed.selectedArtifacts);
    const existing = grouped.get(scenario.artifact_selection_differ_group) ?? [];
    existing.push({ scenarioId: result.scenarioId, artifactSet });
    grouped.set(scenario.artifact_selection_differ_group, existing);
  }

  const violations: ArtifactSelectionDifferenceViolation[] = [];
  for (const [group, entries] of grouped.entries()) {
    const bySetKey = new Map<string, string[]>();

    for (const entry of entries) {
      const key = entry.artifactSet.join("|");
      const ids = bySetKey.get(key) ?? [];
      ids.push(entry.scenarioId);
      bySetKey.set(key, ids);
    }

    for (const [setKey, scenarioIds] of bySetKey.entries()) {
      if (scenarioIds.length > 1) {
        violations.push({
          differGroup: group,
          artifactSet: setKey.length > 0 ? setKey.split("|") : [],
          scenarioIds,
        });
      }
    }
  }

  return violations;
}

function computeCannedPlanViolations(
  scenarios: readonly ScenarioDefinition[],
  results: readonly ScenarioRunResult[],
): CannedPlanViolation[] {
  const scenarioById = new Map<string, ScenarioDefinition>(scenarios.map((scenario) => [scenario.id, scenario]));
  const violations: CannedPlanViolation[] = [];

  for (let i = 0; i < results.length; i += 1) {
    for (let j = i + 1; j < results.length; j += 1) {
      const a = results[i];
      const b = results[j];
      const scenarioA = scenarioById.get(a.scenarioId);
      const scenarioB = scenarioById.get(b.scenarioId);
      if (!scenarioA || !scenarioB) {
        continue;
      }

      if (areRelatedScenarios(scenarioA, scenarioB)) {
        continue;
      }

      const similarity = plannerSimilarity(
        a.plannerCheck.observed.normalizedPlannerText,
        b.plannerCheck.observed.normalizedPlannerText,
      );

      const identical =
        a.plannerCheck.observed.normalizedPlannerText.length > 0 &&
        a.plannerCheck.observed.normalizedPlannerText === b.plannerCheck.observed.normalizedPlannerText;

      if (identical || similarity >= 0.9) {
        violations.push({
          scenarioIdA: a.scenarioId,
          scenarioIdB: b.scenarioId,
          similarity,
        });
      }
    }
  }

  return violations;
}

function areRelatedScenarios(a: ScenarioDefinition, b: ScenarioDefinition): boolean {
  if (a.artifact_selection_differ_group && b.artifact_selection_differ_group) {
    if (a.artifact_selection_differ_group === b.artifact_selection_differ_group) {
      return false;
    }
  }

  if (a.expected_primary_artifact === b.expected_primary_artifact) {
    return true;
  }

  const keywordsA = new Set(buildIntentKeywords(a.request));
  const keywordsB = new Set(buildIntentKeywords(b.request));
  const shared = [...keywordsA].filter((keyword) => keywordsB.has(keyword)).length;
  const union = new Set([...keywordsA, ...keywordsB]).size;

  if (union === 0) {
    return false;
  }

  const jaccard = shared / union;
  return jaccard >= 0.35;
}

function plannerSimilarity(textA: string, textB: string): number {
  const tokensA = tokenizeForSimilarity(textA);
  const tokensB = tokenizeForSimilarity(textB);
  if (tokensA.size === 0 || tokensB.size === 0) {
    return 0;
  }

  const intersection = [...tokensA].filter((token) => tokensB.has(token)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

function tokenizeForSimilarity(text: string): Set<string> {
  const normalized = normalizeText(text);
  const stopwords = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "will", "should", "step"]);

  return new Set(
    normalized
      .split(/[^a-z0-9-]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !stopwords.has(token)),
  );
}

function normalizeArtifactSet(artifacts: readonly string[]): string[] {
  return [...new Set(artifacts)].sort((a, b) => a.localeCompare(b));
}

function classifyFailureCategory(args: {
  artifactSelectionPassed: boolean;
  plannerPassed: boolean;
  siblingPassed: boolean;
  urlPassed: boolean;
  assertionPassed: boolean;
}):
  | "planner_mismatch"
  | "artifact_mismatch"
  | "entity_assertion_failure"
  | "sibling_mismatch"
  | "url_mismatch" {
  if (!args.artifactSelectionPassed) {
    return "artifact_mismatch";
  }

  if (!args.plannerPassed) {
    return "planner_mismatch";
  }

  if (!args.siblingPassed) {
    return "sibling_mismatch";
  }

  if (!args.urlPassed) {
    return "url_mismatch";
  }

  return "entity_assertion_failure";
}
