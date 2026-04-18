import type { AuthProvider } from "../auth/authProvider";
import type { McpClient } from "../clients/mcpClient";
import { runUiCheck } from "../checks/stepChecks";
import { runArtifactSelectionCheck, type ArtifactSelectionCheckResult } from "../checks/artifactSelectionCheck";
import { runPlannerCheck, type PlannerCheckResult } from "../checks/plannerCheck";
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

export interface HarnessRunReport {
  readonly generatedAtIso: string;
  readonly summary: {
    readonly totalScenarios: number;
    readonly passedScenarios: number;
    readonly failedScenarios: number;
    readonly scenariosUsingCoreBypass: number;
  };
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
    expectedPrimaryArtifact: "",
    observedPrimaryArtifact: null,
    missingRequiredArtifacts: [],
    presentForbiddenArtifacts: [],
    unexpectedArtifacts: [],
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

    const passedScenarios = scenarioResults.filter((result) => result.passed).length;

    return {
      generatedAtIso: new Date().toISOString(),
      summary: {
        totalScenarios: scenarioResults.length,
        passedScenarios,
        failedScenarios: scenarioResults.length - passedScenarios,
        scenariosUsingCoreBypass: scenarioResults.filter((result) => result.coreBypass.used).length,
      },
      scenarios: scenarioResults,
    };
  }
}
