import { loadEnvConfig } from "./config/env";
import { buildCachedTokenAuthProvider } from "./auth/authProvider";
import { buildHttpMcpClient } from "./clients/mcpClient";
import { discoverScenarios } from "./scenarios/discovery";
import { ScenarioRunner } from "./runners/scenarioRunner";
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
    targetMcpUrl: env.mcpTarget.baseUrl,
    targetConfigSource: env.mcpTarget.targetName,
    targetSubmitEndpoint: env.mcpTarget.submitRequestEndpoint,
    targetHealthEndpoint: env.mcpTarget.healthEndpoint,
    configuredAudience: env.mcpTarget.audience,
  });

  await probeMcpConnectivity({
    baseUrl: env.mcpTarget.baseUrl,
    healthEndpoint: env.mcpTarget.healthEndpoint,
    submitEndpoint: env.mcpTarget.submitRequestEndpoint,
    bearerToken: session.accessToken,
    tokenMode: env.MCP_AUTH_TOKEN_MODE,
    tokenType: session.tokenType,
    audience: session.audience,
  });

  const mcpClient = buildHttpMcpClient({
    baseUrl: env.mcpTarget.baseUrl,
    authTokenProvider: async () => {
      const refreshedSession = await authProvider.getSession();
      return refreshedSession.accessToken;
    },
    endpoints: {
      submitRequest: env.mcpTarget.submitRequestEndpoint,
      artifactSelection: env.MCP_ENDPOINT_ARTIFACT_SELECTION,
      plannerOutput: env.MCP_ENDPOINT_PLANNER_OUTPUT,
      siblingInfo: env.MCP_ENDPOINT_SIBLING_INFO,
      siblingUrl: env.MCP_ENDPOINT_SIBLING_URL,
      branchInfo: env.MCP_ENDPOINT_BRANCH_INFO,
    },
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
    configuredTokenMode: env.MCP_AUTH_TOKEN_MODE,
    artifactsDir: env.ARTIFACTS_DIR,
  });

  const report = await runner.runSequentially(scenarios);
  await writeLatestReport(report, env.ARTIFACTS_DIR);

  const summary = {
    scenarioId: env.HARNESS_SCENARIO_ID,
    totalScenarios: report.summary.totalScenarios,
    passedScenarios: report.summary.passedScenarios,
    failedScenarios: report.summary.failedScenarios,
    blockedScenarios: report.summary.blockedScenarios,
    artifactMismatches: report.summary.artifactMismatches,
    plannerMismatches: report.summary.plannerMismatches,
    entityAssertionMismatches: report.summary.entityAssertionMismatches,
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
  const message = error instanceof Error ? error.message : String(error);
  const category = message.includes("Scenario schema validation failure")
    ? "schema_validation_failure"
    : "harness_failure";
  console.error("Harness failed", { category, message });
  process.exitCode = 1;
});

async function probeMcpConnectivity(args: {
  baseUrl: string;
  healthEndpoint: string;
  submitEndpoint: string;
  bearerToken: string;
  tokenMode: "access_token" | "id_token";
  tokenType: "access_token" | "id_token";
  audience: string | string[] | null;
}): Promise<void> {
  const probeUrl = new URL(args.healthEndpoint, args.baseUrl).toString();

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
      `MCP server appears to require MCP protocol at '/mcp' (SSE/JSON-RPC), but submit endpoint is configured as '${args.submitEndpoint}'. Update DEAL_FINDER_MCP_ENDPOINT_SUBMIT_REQUEST (or MCP_ENDPOINT_SUBMIT_REQUEST) to '/mcp' and add MCP protocol transport support in the harness client.`,
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

  if (firstFailedScenario.failureCategory === "mcp_request_failure") {
    return {
      scenarioId: firstFailedScenario.scenarioId,
      gate: "mcp_request_failure",
      details: [firstFailedScenario.mcpDetails],
    };
  }

  if (firstFailedScenario.failureCategory === "artifact_mismatch") {
    return {
      scenarioId: firstFailedScenario.scenarioId,
      gate: "artifact_mismatch",
      details: firstFailedScenario.artifactSelectionCheck.details,
    };
  }

  if (firstFailedScenario.failureCategory === "planner_mismatch") {
    return {
      scenarioId: firstFailedScenario.scenarioId,
      gate: "planner_mismatch",
      details: firstFailedScenario.plannerCheck.details,
    };
  }

  if (firstFailedScenario.failureCategory === "sibling_mismatch") {
    return {
      scenarioId: firstFailedScenario.scenarioId,
      gate: "sibling_mismatch",
      details: firstFailedScenario.siblingCheck.details,
    };
  }

  if (firstFailedScenario.failureCategory === "url_mismatch") {
    return {
      scenarioId: firstFailedScenario.scenarioId,
      gate: "url_mismatch",
      details: firstFailedScenario.urlCheck.details,
    };
  }

  if (firstFailedScenario.failureCategory === "blocked_scenario" && firstFailedScenario.blockedReason) {
    return {
      scenarioId: firstFailedScenario.scenarioId,
      gate: "blocked_scenario",
      details: [firstFailedScenario.blockedReason],
    };
  }

  if (firstFailedScenario.failureCategory === "entity_assertion_failure") {
    const assertionFailures = Object.entries(firstFailedScenario.assertionChecks).filter(
      ([, check]) => !check.passed,
    );
    const [name, check] = assertionFailures[0] ?? ["unknown", { details: [firstFailedScenario.mcpDetails] }];
    return {
      scenarioId: firstFailedScenario.scenarioId,
      gate: `entity_assertion_failure:${name}`,
      details: check.details,
    };
  }

  return {
    scenarioId: firstFailedScenario.scenarioId,
    gate: "unknown",
    details: ["Scenario failed but no failing gate was identified"],
  };
}
