import type { AuthProvider } from "../auth/authProvider";
import type { McpClient } from "../clients/mcpClient";
import { runUiCheck } from "../checks/stepChecks";
import { runArtifactSelectionCheck, type ArtifactSelectionCheckResult } from "../checks/artifactSelectionCheck";
import {
  buildIntentKeywords,
  normalizeText,
  runPlannerCheck,
  type PlannerCheckResult,
} from "../checks/plannerCheck";
import { runSiblingCheck, type SiblingCheckResult } from "../checks/siblingCheck";
import { runUrlCheck, type UrlCheckResult } from "../checks/urlCheck";
import type { StructuredCheckResult } from "../checks/campaignCrudCheck";
import type { CommandPaletteVerifier } from "../ui/playwright/commandPalette";
import type { ScenarioDefinition } from "../scenarios/types";
import { CoreBypassRunner, type CoreBypassResult } from "./coreBypassRunner";
import { VerificationRunner, type VerificationResult } from "./verificationRunner";

export interface ScenarioRunResult {
  readonly scenarioId: string;
  readonly title: string;
  readonly passed: boolean;
  readonly startedAtIso: string;
  readonly endedAtIso: string;
  readonly mcpDetails: string;
  readonly artifactSelectionCheck: ArtifactSelectionCheckResult;
  readonly plannerCheck: PlannerCheckResult;
  readonly siblingCheck: SiblingCheckResult;
  readonly urlCheck: UrlCheckResult;
  readonly verification: VerificationResult;
  readonly uiChecks: readonly StructuredCheckResult[];
  readonly coreBypass: CoreBypassResult;
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
    readonly scenariosUsingCoreBypass: number;
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
  readonly uiVerifier: CommandPaletteVerifier;
  readonly coreBypassRunner: CoreBypassRunner;
  readonly verificationRunner: VerificationRunner;
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

const MISSING_DEVELOPMENT_RESULT_SIBLING_CHECK: SiblingCheckResult = {
  passed: false,
  details: ["MCP development result is missing; cannot validate sibling information"],
  observed: {
    siblingId: null,
    siblingUrl: null,
    branchName: null,
    requireBranchIsolation: false,
    missingFields: ["siblingId", "siblingUrl"],
  },
};

const SKIPPED_URL_CHECK: UrlCheckResult = {
  passed: false,
  details: ["URL check skipped because siblingUrl is unavailable"],
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

const SKIPPED_VERIFICATION: VerificationResult = {
  passed: false,
  details: ["Playwright verification skipped"],
  observed: {
    scenarioId: "",
    siblingUrl: null,
    commands: [],
    startedAtIso: new Date(0).toISOString(),
    endedAtIso: new Date(0).toISOString(),
    durationMs: 0,
    screenshotPaths: [],
    appShellAssertion: {},
    loginCheck: {},
    commandResults: [],
  },
};

export class ScenarioRunner {
  constructor(private readonly deps: ScenarioRunnerDependencies) {}

  async runSequentially(scenarios: readonly ScenarioDefinition[]): Promise<HarnessRunReport> {
    await this.deps.authProvider.getSession();

    const scenarioResults: ScenarioRunResult[] = [];

    for (const scenario of scenarios) {
      const startedAtIso = new Date().toISOString();
      const mcpResult = await this.deps.mcpClient.planScenario(scenario);

      if (!mcpResult.ok || !mcpResult.developmentResult) {
        scenarioResults.push({
          scenarioId: scenario.id,
          title: scenario.title,
          passed: false,
          startedAtIso,
          endedAtIso: new Date().toISOString(),
          mcpDetails: mcpResult.details,
          artifactSelectionCheck: MISSING_DEVELOPMENT_RESULT_ARTIFACT_CHECK,
          plannerCheck: MISSING_DEVELOPMENT_RESULT_PLANNER_CHECK,
          siblingCheck: MISSING_DEVELOPMENT_RESULT_SIBLING_CHECK,
          urlCheck: SKIPPED_URL_CHECK,
          verification: SKIPPED_VERIFICATION,
          uiChecks: [],
          coreBypass: {
            used: false,
            authorized: scenario.allow_core_bypass,
            succeeded: false,
            log: "Skipped due to MCP planning failure",
          },
        });
        continue;
      }

      const artifactSelectionCheck = runArtifactSelectionCheck(scenario, mcpResult.developmentResult);
      const plannerCheck = runPlannerCheck(scenario, mcpResult.developmentResult);
      const siblingCheck = runSiblingCheck(scenario, mcpResult.developmentResult);

      const urlCheck = await runUrlCheck(mcpResult.developmentResult.siblingUrl);

      let bypassResult: CoreBypassResult = {
        used: false,
        authorized: scenario.allow_core_bypass,
        succeeded: true,
        log: "Core bypass not required",
      };

      if (mcpResult.requiresCoreXynChanges) {
        bypassResult = await this.deps.coreBypassRunner.run(scenario.allow_core_bypass);

        if (!scenario.allow_core_bypass || !bypassResult.succeeded) {
          scenarioResults.push({
            scenarioId: scenario.id,
            title: scenario.title,
            passed: false,
            startedAtIso,
            endedAtIso: new Date().toISOString(),
            mcpDetails: `${mcpResult.details}; core bypass not available`,
            artifactSelectionCheck,
            plannerCheck,
            siblingCheck,
            urlCheck,
            verification: SKIPPED_VERIFICATION,
            uiChecks: [],
            coreBypass: bypassResult,
          });
          continue;
        }
      }

      this.deps.uiVerifier.setActiveSiblingUrl(mcpResult.developmentResult.siblingUrl);

      const verification = await this.deps.verificationRunner.run(
        scenario,
        mcpResult.developmentResult.siblingUrl,
      );

      const uiResults: StructuredCheckResult[] = [];
      let scenarioPassed =
        artifactSelectionCheck.passed &&
        plannerCheck.passed &&
        siblingCheck.passed &&
        urlCheck.passed &&
        verification.passed;

      for (const check of scenario.ui_checks) {
        const uiResult = await runUiCheck(check, this.deps.uiVerifier);
        uiResults.push(uiResult);
        if (uiResult.status === "failed") {
          scenarioPassed = false;
        }
      }

      scenarioResults.push({
        scenarioId: scenario.id,
        title: scenario.title,
        passed: scenarioPassed,
        startedAtIso,
        endedAtIso: new Date().toISOString(),
        mcpDetails: mcpResult.details,
        artifactSelectionCheck,
        plannerCheck,
        siblingCheck,
        urlCheck,
        verification,
        uiChecks: uiResults,
        coreBypass: bypassResult,
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
        mcpDetails: `${result.mcpDetails}; canned-plan detector violation`,
      };
    });

    const passedScenarios = resultsWithCannedEnforcement.filter((result) => result.passed).length;

    return {
      generatedAtIso: new Date().toISOString(),
      summary: {
        totalScenarios: resultsWithCannedEnforcement.length,
        passedScenarios,
        failedScenarios: resultsWithCannedEnforcement.length - passedScenarios,
        scenariosUsingCoreBypass: resultsWithCannedEnforcement.filter((result) => result.coreBypass.used).length,
        artifactSelectionDifferenceViolations: differenceViolations.length,
        cannedPlanViolations: cannedPlanViolations.length,
      },
      artifactSelectionDifferenceViolations: differenceViolations,
      cannedPlanViolations,
      scenarios: resultsWithCannedEnforcement,
    };
  }
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
  const stopwords = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "into",
    "will",
    "should",
    "step",
  ]);

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
