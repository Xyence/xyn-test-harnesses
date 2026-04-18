import { loadEnvConfig } from "./config/env";
import { buildPlaceholderAuthProvider } from "./auth/authProvider";
import { buildHttpMcpClient } from "./clients/mcpClient";
import { buildPlaceholderCommandPaletteVerifier } from "./ui/playwright/commandPalette";
import { discoverScenarios } from "./scenarios/discovery";
import { ScenarioRunner } from "./runners/scenarioRunner";
import { CoreBypassRunner } from "./runners/coreBypassRunner";
import { VerificationRunner } from "./runners/verificationRunner";
import { writeLatestReport } from "./reports/reportWriter";

async function main(): Promise<void> {
  const env = loadEnvConfig();

  const authProvider = buildPlaceholderAuthProvider();
  const mcpClient = buildHttpMcpClient({
    baseUrl: env.MCP_BASE_URL,
    authToken: env.MCP_AUTH_TOKEN,
    endpoints: {
      submitRequest: env.MCP_ENDPOINT_SUBMIT_REQUEST,
      artifactSelection: env.MCP_ENDPOINT_ARTIFACT_SELECTION,
      plannerOutput: env.MCP_ENDPOINT_PLANNER_OUTPUT,
      siblingInfo: env.MCP_ENDPOINT_SIBLING_INFO,
      siblingUrl: env.MCP_ENDPOINT_SIBLING_URL,
      branchInfo: env.MCP_ENDPOINT_BRANCH_INFO,
    },
  });
  const uiVerifier = buildPlaceholderCommandPaletteVerifier({
    baseUrl: env.XYN_UI_BASE_URL,
  });
  const coreBypassRunner = new CoreBypassRunner();
  const verificationRunner = new VerificationRunner({
    artifactsDir: env.ARTIFACTS_DIR,
    storageStatePath: env.PLAYWRIGHT_STORAGE_STATE,
    headless: env.PLAYWRIGHT_HEADLESS,
  });

  const discovered = await discoverScenarios();
  const scenarios = discovered.filter((scenario) => scenario.id === env.HARNESS_SCENARIO_ID);
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
    latestReportPath: `${env.ARTIFACTS_DIR}/reports/latest.json`,
  };

  console.log("Harness run complete", summary);
}

main().catch((error: unknown) => {
  console.error("Harness failed", error);
  process.exitCode = 1;
});
