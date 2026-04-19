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
    preferredTokenMode: env.MCP_AUTH_TOKEN_MODE,
  });

  const session = await authProvider.getSession();
  console.log("MCP auth diagnostics", {
    tokenPresent: session.accessToken.length > 0,
    tokenType: session.tokenType,
    expiry: session.expiresAtIso,
    audience: session.audience,
    targetMcpUrl: env.MCP_BASE_URL,
  });

  await probeMcpConnectivity({
    baseUrl: env.MCP_BASE_URL,
    submitEndpoint: env.MCP_ENDPOINT_SUBMIT_REQUEST,
    bearerToken: session.accessToken,
    tokenMode: env.MCP_AUTH_TOKEN_MODE,
    tokenType: session.tokenType,
    audience: session.audience,
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
    configuredTokenMode: env.MCP_AUTH_TOKEN_MODE,
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

  const firstFailedGate = findFirstFailedGate(report);
  if (firstFailedGate) {
    console.error("First failed gate", firstFailedGate);
  }

  console.log("Harness run complete", summary);
}

main().catch((error: unknown) => {
  console.error("Harness failed", error);
  process.exitCode = 1;
});

async function probeMcpConnectivity(args: {
  baseUrl: string;
  submitEndpoint: string;
  bearerToken: string;
  tokenMode: "access_token" | "id_token";
  tokenType: "access_token" | "id_token";
  audience: string | string[] | null;
}): Promise<void> {
  const probeUrl = new URL("/mcp", args.baseUrl).toString();

  const response = await fetch(probeUrl, {
    method: "GET",
    headers: {
      authorization: `Bearer ${args.bearerToken}`,
      accept: "text/event-stream",
    },
  });

  const bodyText = await response.text().catch(() => "");
  const bodySnippet = bodyText.slice(0, 500);
  const contentType = response.headers.get("content-type");
  const hasSessionHeader = response.headers.has("mcp-session-id");
  const looksLikeJsonRpc = bodyText.includes('"jsonrpc":"2.0"');
  const indicatesMcpSse = hasSessionHeader || looksLikeJsonRpc;

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `MCP probe unauthorized (${response.status}). tokenMode=${args.tokenMode}, tokenType=${args.tokenType}, audience=${String(
        args.audience,
      )}, probeUrl=${probeUrl}, response=${bodySnippet}`,
    );
  }

  if (indicatesMcpSse && args.submitEndpoint !== "/mcp") {
    throw new Error(
      `MCP server appears to require MCP protocol at '/mcp' (SSE/JSON-RPC), but submit endpoint is configured as '${args.submitEndpoint}'. Update MCP_ENDPOINT_SUBMIT_REQUEST to '/mcp' and add MCP protocol transport support in the harness client.`,
    );
  }

  console.log("MCP connectivity probe", {
    probeUrl,
    status: response.status,
    contentType,
    hasMcpSessionHeader: hasSessionHeader,
    indicatesMcpProtocol: indicatesMcpSse,
  });
}

function findFirstFailedGate(
  report: Awaited<ReturnType<ScenarioRunner["runSequentially"]>>,
): { scenarioId: string; gate: string; details: string[] } | null {
  const firstFailedScenario = report.scenarios.find((scenario) => !scenario.passed);
  if (!firstFailedScenario) {
    return null;
  }

  if (firstFailedScenario.mcpDetails.includes("MCP planning failed")) {
    return {
      scenarioId: firstFailedScenario.scenarioId,
      gate: "mcp_planning",
      details: [firstFailedScenario.mcpDetails],
    };
  }

  if (!firstFailedScenario.artifactSelectionCheck.passed) {
    return {
      scenarioId: firstFailedScenario.scenarioId,
      gate: "artifact_selection",
      details: firstFailedScenario.artifactSelectionCheck.details,
    };
  }

  if (!firstFailedScenario.plannerCheck.passed) {
    return {
      scenarioId: firstFailedScenario.scenarioId,
      gate: "planner",
      details: firstFailedScenario.plannerCheck.details,
    };
  }

  if (!firstFailedScenario.siblingCheck.passed) {
    return {
      scenarioId: firstFailedScenario.scenarioId,
      gate: "sibling",
      details: firstFailedScenario.siblingCheck.details,
    };
  }

  if (!firstFailedScenario.urlCheck.passed) {
    return {
      scenarioId: firstFailedScenario.scenarioId,
      gate: "url_check",
      details: firstFailedScenario.urlCheck.details,
    };
  }

  if (!firstFailedScenario.coreBypass.succeeded) {
    return {
      scenarioId: firstFailedScenario.scenarioId,
      gate: "core_bypass",
      details: [firstFailedScenario.coreBypass.log],
    };
  }

  if (!firstFailedScenario.verification.passed) {
    return {
      scenarioId: firstFailedScenario.scenarioId,
      gate: "playwright_verification",
      details: firstFailedScenario.verification.details,
    };
  }

  const firstFailedUiCheck = firstFailedScenario.uiChecks.find((check) => check.status === "failed");
  if (firstFailedUiCheck) {
    return {
      scenarioId: firstFailedScenario.scenarioId,
      gate: `ui_check:${firstFailedUiCheck.checkType}`,
      details: [firstFailedUiCheck.message],
    };
  }

  return {
    scenarioId: firstFailedScenario.scenarioId,
    gate: "unknown",
    details: ["Scenario failed but no failing gate was identified"],
  };
}
