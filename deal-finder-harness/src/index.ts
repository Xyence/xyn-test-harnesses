import { loadEnvConfig } from "./config/env";
import { buildCachedTokenAuthProvider } from "./auth/authProvider";
import { buildHttpMcpClient } from "./clients/mcpClient";
import { buildPlaywrightCommandPaletteVerifier } from "./ui/playwright/commandPalette";
import { discoverScenarios } from "./scenarios/discovery";
import { ScenarioRunner } from "./runners/scenarioRunner";
import { CoreBypassRunner } from "./runners/coreBypassRunner";
import { VerificationRunner } from "./runners/verificationRunner";
import { writeLatestReport } from "./reports/reportWriter";

async function main(): Promise<void> {
  const env = loadEnvConfig();

  const authProvider = buildCachedTokenAuthProvider({
    tokenFilePath: env.MCP_AUTH_TOKEN_FILE,
    googleClientId: env.GOOGLE_OAUTH_CLIENT_ID ?? env.XYN_OIDC_CLIENT_ID,
    googleClientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
  });

  const session = await authProvider.getSession();
  console.log("MCP auth diagnostics", {
    tokenPresent: session.accessToken.length > 0,
    tokenType: session.tokenType,
    expiry: session.expiresAtIso,
    audience: session.audience,
    targetMcpUrl: env.MCP_BASE_URL,
  });

  const mcpClient = buildHttpMcpClient({
    baseUrl: env.MCP_BASE_URL,
    authTokenProvider: async () => {
      const refreshedSession = await authProvider.getSession();
      return refreshedSession.accessToken;
    },
    endpoints: {
      submitRequest: env.MCP_ENDPOINT_SUBMIT_REQUEST,
      artifactSelection: env.MCP_ENDPOINT_ARTIFACT_SELECTION,
      plannerOutput: env.MCP_ENDPOINT_PLANNER_OUTPUT,
      siblingInfo: env.MCP_ENDPOINT_SIBLING_INFO,
      siblingUrl: env.MCP_ENDPOINT_SIBLING_URL,
      branchInfo: env.MCP_ENDPOINT_BRANCH_INFO,
    },
  });

  const uiVerifier = buildPlaywrightCommandPaletteVerifier({
    storageStatePath: env.PLAYWRIGHT_STORAGE_STATE,
    artifactsDir: env.ARTIFACTS_DIR,
    headless: env.PLAYWRIGHT_HEADLESS,
  });
  const coreBypassRunner = new CoreBypassRunner();
  const verificationRunner = new VerificationRunner({
    artifactsDir: env.ARTIFACTS_DIR,
    storageStatePath: env.PLAYWRIGHT_STORAGE_STATE,
    headless: env.PLAYWRIGHT_HEADLESS,
  });

  const discovered = await discoverScenarios();
  const scenarios =
    env.HARNESS_SCENARIO_ID === "all"
      ? discovered
      : discovered.filter((scenario) => scenario.id === env.HARNESS_SCENARIO_ID);

  if (scenarios.length === 0) {
    throw new Error(`Scenario '${env.HARNESS_SCENARIO_ID}' not found in src/scenarios`);
  }

  const runner = new ScenarioRunner({
    authProvider,
    mcpClient,
    uiVerifier,
    coreBypassRunner,
    verificationRunner,
  });

  const report = await runner.runSequentially(scenarios);
  await writeLatestReport(report, env.ARTIFACTS_DIR);

  const summary = {
    scenarioId: env.HARNESS_SCENARIO_ID,
    totalScenarios: report.summary.totalScenarios,
    passedScenarios: report.summary.passedScenarios,
    failedScenarios: report.summary.failedScenarios,
    scenariosUsingCoreBypass: report.summary.scenariosUsingCoreBypass,
    artifactSelectionDifferenceViolations: report.summary.artifactSelectionDifferenceViolations,
    cannedPlanViolations: report.summary.cannedPlanViolations,
    latestReportPath: `${env.ARTIFACTS_DIR}/reports/latest.json`,
  };

  console.log("Harness run complete", summary);
}

main().catch((error: unknown) => {
  console.error("Harness failed", error);
  process.exitCode = 1;
});
