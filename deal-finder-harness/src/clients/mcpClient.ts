import type { ScenarioDefinition } from "../scenarios/types";

interface McpEndpointMap {
  readonly submitRequest: string;
  readonly artifactSelection?: string;
  readonly plannerOutput?: string;
  readonly siblingInfo?: string;
  readonly siblingUrl?: string;
  readonly branchInfo?: string;
}

// TODO: Confirm canonical MCP endpoint paths. Only `submitRequest` is assumed here.
// Additional endpoints are optional and should be enabled once confirmed.
const DEFAULT_ENDPOINTS: McpEndpointMap = {
  submitRequest: "/mcp/development/requests",
};

type HttpMethod = "GET" | "POST";

export interface HttpRequest {
  readonly method: HttpMethod;
  readonly path: string;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly query?: Record<string, string | number | boolean | undefined>;
}

export interface HttpResponse<TData> {
  readonly status: number;
  readonly ok: boolean;
  readonly data: TData;
  readonly headers: Record<string, string>;
}

export interface HttpClient {
  request<TData>(request: HttpRequest): Promise<HttpResponse<TData>>;
}

export interface McpDevelopmentConfig {
  readonly baseUrl: string;
  readonly authTokenProvider: () => Promise<string>;
  readonly timeoutMs?: number;
  readonly endpoints?: Partial<McpEndpointMap>;
  readonly extraHeaders?: Record<string, string>;
  readonly httpClient?: HttpClient;
}

export interface ArtifactSelectionDetail {
  readonly artifact: string;
  readonly rationale: string | null;
  readonly dependencyReason: string | null;
  readonly confidence: number | null;
}

export interface DevelopmentRequestResult {
  readonly requestText: string;
  readonly selectedArtifacts: readonly string[];
  readonly initialSuggestedArtifacts: readonly string[];
  readonly finalSelectedArtifacts: readonly string[];
  readonly primaryArtifact: string;
  readonly dependentArtifacts: readonly string[];
  readonly artifactDetails: readonly ArtifactSelectionDetail[];
  readonly plannerPlan: unknown;
  readonly siblingId: string;
  readonly siblingUrl: string;
  readonly branchName: string | null;
  readonly rawResponses: {
    readonly submitRequest: unknown;
    readonly artifactSelection: unknown;
    readonly plannerOutput: unknown;
    readonly siblingInfo: unknown;
    readonly siblingUrl: unknown;
    readonly branchInfo: unknown;
  };
}

interface MutableRawResponses {
  submitRequest: unknown;
  artifactSelection: unknown;
  plannerOutput: unknown;
  siblingInfo: unknown;
  siblingUrl: unknown;
  branchInfo: unknown;
}

interface ArtifactSelectionResolution {
  readonly initialSuggestedArtifacts: readonly string[];
  readonly finalSelectedArtifacts: readonly string[];
  readonly primaryArtifact: string;
  readonly dependentArtifacts: readonly string[];
}

export interface McpScenarioPlanResult {
  readonly ok: boolean;
  readonly details: string;
  readonly requiresCoreXynChanges: boolean;
  readonly developmentResult?: DevelopmentRequestResult;
  readonly httpFailure?: {
    readonly status: number;
    readonly errorBody: unknown;
    readonly endpoint: string;
  };
}

export interface McpClient {
  planScenario(scenario: ScenarioDefinition): Promise<McpScenarioPlanResult>;
}

class FetchHttpClient implements HttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly defaultHeaders: Record<string, string>,
    private readonly authTokenProvider: () => Promise<string>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request<TData>(request: HttpRequest): Promise<HttpResponse<TData>> {
    const url = new URL(request.path, this.baseUrl);

    if (request.query) {
      for (const [key, value] of Object.entries(request.query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const authToken = await this.authTokenProvider();

    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...request.headers,
      authorization: `Bearer ${authToken}`,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: request.method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal,
      });

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const data = (await response.json().catch(() => ({}))) as TData;

      return {
        status: response.status,
        ok: response.ok,
        data,
        headers: responseHeaders,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class HttpMcpClient implements McpClient {
  constructor(private readonly config: McpDevelopmentConfig) {}

  async planScenario(scenario: ScenarioDefinition): Promise<McpScenarioPlanResult> {
    try {
      const developmentResult = await submitDevelopmentRequest(this.config, scenario);
      const requiresCoreXynChanges = extractBooleanFromUnknown(developmentResult.plannerPlan, [
        ["requiresCoreXynChanges"],
        ["requires_core_xyn_changes"],
        ["flags", "requiresCoreXynChanges"],
      ]);

      return {
        ok: true,
        details: `MCP development request submitted for '${scenario.id}'`,
        requiresCoreXynChanges,
        developmentResult,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown MCP planning error";
      const httpFailure =
        error instanceof McpHttpError
          ? {
              status: error.status,
              errorBody: error.errorBody,
              endpoint: error.endpoint,
            }
          : undefined;
      return {
        ok: false,
        details: `MCP planning failed for '${scenario.id}': ${message}`,
        requiresCoreXynChanges: false,
        httpFailure,
      };
    }
  }
}

export async function submitDevelopmentRequest(
  config: McpDevelopmentConfig,
  scenario: ScenarioDefinition,
): Promise<DevelopmentRequestResult> {
  const endpoints = resolveEndpoints(config.endpoints);

  if (endpoints.submitRequest === "/mcp") {
    return submitDevelopmentRequestViaMcpProtocol(config, scenario);
  }

  return submitDevelopmentRequestViaRest(config, scenario);
}

async function submitDevelopmentRequestViaRest(
  config: McpDevelopmentConfig,
  scenario: ScenarioDefinition,
): Promise<DevelopmentRequestResult> {
  const endpoints = resolveEndpoints(config.endpoints);
  const client = config.httpClient ?? buildDefaultHttpClient(config);

  const submitResponse = await client.request<Record<string, unknown>>({
    method: "POST",
    path: endpoints.submitRequest,
    body: {
      requestText: scenario.request,
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      expectedArtifacts: scenario.expected_artifacts,
      expectedPrimaryArtifact: scenario.expected_primary_artifact,
      metadata: buildScenarioPlannerMetadata(scenario),
    },
  });

  if (!submitResponse.ok) {
    throw new McpHttpError({
      endpoint: endpoints.submitRequest,
      status: submitResponse.status,
      errorBody: submitResponse.data,
      message: `submitRequest failed with status ${submitResponse.status}; raw=${safeStringify(submitResponse.data)}`,
    });
  }

  const requestId = extractFirstString(submitResponse.data, [["requestId"], ["request_id"], ["id"]]) ?? null;

  const rawResponses: MutableRawResponses = {
    submitRequest: submitResponse.data,
    artifactSelection: null,
    plannerOutput: null,
    siblingInfo: null,
    siblingUrl: null,
    branchInfo: null,
  };

  const artifactSelectionResponse = await requestOptionalEndpoint(
    client,
    endpoints.artifactSelection ?? null,
    requestId,
    scenario,
  );
  rawResponses.artifactSelection = artifactSelectionResponse;

  const plannerOutputResponse = await requestOptionalEndpoint(
    client,
    endpoints.plannerOutput ?? null,
    requestId,
    scenario,
  );
  rawResponses.plannerOutput = plannerOutputResponse;

  const siblingInfoResponse = await requestOptionalEndpoint(
    client,
    endpoints.siblingInfo ?? null,
    requestId,
    scenario,
  );
  rawResponses.siblingInfo = siblingInfoResponse;

  const siblingUrlResponse = await requestOptionalEndpoint(
    client,
    endpoints.siblingUrl ?? null,
    requestId,
    scenario,
  );
  rawResponses.siblingUrl = siblingUrlResponse;

  const branchInfoResponse = await requestOptionalEndpoint(
    client,
    endpoints.branchInfo ?? null,
    requestId,
    scenario,
  );
  rawResponses.branchInfo = branchInfoResponse;

  const artifactDetails =
    extractArtifactDetails(submitResponse.data) ??
    extractArtifactDetails(artifactSelectionResponse) ??
    ([] as ArtifactSelectionDetail[]);

  const selectedArtifactsFromDetails =
    artifactDetails.length > 0 ? artifactDetails.map((detail) => detail.artifact) : undefined;

  const plannerPlan =
    resolvePlannerPlan({
      submitResponse: submitResponse.data,
      plannerOutputResponse,
      fallbackSources: [submitResponse.data, plannerOutputResponse],
    });

  const siblingId =
    extractFirstString(submitResponse.data, [["siblingId"], ["sibling", "id"], ["sibling_id"]]) ??
    extractFirstString(siblingInfoResponse, [["siblingId"], ["sibling", "id"], ["sibling_id"]]);

  const siblingUrl =
    extractFirstString(submitResponse.data, [["siblingUrl"], ["sibling", "url"], ["sibling_url"]]) ??
    extractFirstString(siblingUrlResponse, [["siblingUrl"], ["sibling", "url"], ["sibling_url"]]);

  const branchName =
    extractFirstString(submitResponse.data, [["branchName"], ["branch", "name"], ["branch_name"]]) ??
    extractFirstString(branchInfoResponse, [["branchName"], ["branch", "name"], ["branch_name"]]);

  if (scenario.deployment.require_branch_isolation && !branchName) {
    throw new Error(
      `missing-backend-field: branchName is required for branch-isolated scenario '${scenario.id}' but was not present in MCP REST response payloads; rawResponses=${safeStringify(rawResponses)}`,
    );
  }
  const artifactSelection = resolveArtifactSelectionForAssertions({
    artifactDetails,
    initialSources: [submitResponse.data, artifactSelectionResponse],
    finalSources: [plannerOutputResponse, submitResponse.data, artifactSelectionResponse],
    primaryArtifactSources: [plannerOutputResponse, submitResponse.data, artifactSelectionResponse],
    dependentArtifactSources: [plannerOutputResponse, submitResponse.data, artifactSelectionResponse],
    selectedArtifactsFromDetails,
  });

  const missing: string[] = [];
  if (!artifactSelection.finalSelectedArtifacts || artifactSelection.finalSelectedArtifacts.length === 0) {
    missing.push("selectedArtifacts");
  }
  if (!artifactSelection.primaryArtifact) {
    missing.push("primaryArtifact");
  }
  if (!plannerPlan) {
    missing.push("plannerPlan");
  }
  if (!siblingId) {
    missing.push("siblingId");
  }
  if (!siblingUrl) {
    missing.push("siblingUrl");
  }
  if (!artifactSelection.dependentArtifacts) {
    missing.push("dependentArtifacts");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required MCP fields: ${missing.join(", ")}; rawResponses=${safeStringify(rawResponses)}`,
    );
  }

  const requiredSelectedArtifacts = artifactSelection.finalSelectedArtifacts as string[];
  const requiredPrimaryArtifact = artifactSelection.primaryArtifact as string;
  const requiredDependentArtifacts = artifactSelection.dependentArtifacts as string[];
  const requiredPlannerPlan = plannerPlan as unknown;
  const requiredSiblingId = siblingId as string;
  const requiredSiblingUrl = siblingUrl as string;
  const requiredBranchName = branchName ?? null;

  return {
    requestText: scenario.request,
    selectedArtifacts: requiredSelectedArtifacts,
    initialSuggestedArtifacts: artifactSelection.initialSuggestedArtifacts,
    finalSelectedArtifacts: artifactSelection.finalSelectedArtifacts,
    primaryArtifact: requiredPrimaryArtifact,
    dependentArtifacts: requiredDependentArtifacts,
    artifactDetails,
    plannerPlan: requiredPlannerPlan,
    siblingId: requiredSiblingId,
    siblingUrl: requiredSiblingUrl,
    branchName: requiredBranchName,
    rawResponses,
  };
}

interface McpSessionInitResult {
  readonly sessionId: string;
  readonly responseBody: string;
}

async function submitDevelopmentRequestViaMcpProtocol(
  config: McpDevelopmentConfig,
  scenario: ScenarioDefinition,
): Promise<DevelopmentRequestResult> {
  const token = await config.authTokenProvider();
  let lastError: unknown = null;
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const init = await initializeMcpSession(config, token);
      const listApplications = await callMcpTool(config, token, init.sessionId, "list_applications", {});
      const applicationId = extractFirstString(listApplications, [["response", "applications", "0", "id"]]);
      if (!applicationId) {
        throw new Error(`MCP tools/list_applications did not return an application id; raw=${safeStringify(listApplications)}`);
      }

      const createSession = await callMcpTool(config, token, init.sessionId, "create_application_change_session", {
        application_id: applicationId,
        payload: {
          request_text: scenario.request,
          metadata: buildScenarioPlannerMetadata(scenario),
        },
      });

      const sessionId =
        extractFirstString(createSession, [["response", "raw", "session", "id"]]) ??
        extractFirstString(createSession, [["response", "session_id"]]);
      if (!sessionId) {
        throw new Error(
          `MCP create_application_change_session succeeded but session id is missing; raw=${safeStringify(createSession)}`,
        );
      }

      const sessionPlan = await callMcpTool(config, token, init.sessionId, "get_application_change_session_plan", {
        application_id: applicationId,
        session_id: sessionId,
      });

      let previewPrep: unknown = null;
      let previewStatus: unknown = null;
      try {
        previewPrep = await callMcpTool(config, token, init.sessionId, "prepare_preview_application_change_session", {
          application_id: applicationId,
          session_id: sessionId,
        });
      } catch (error: unknown) {
        previewPrep = {
          error: error instanceof Error ? error.message : String(error),
        };
      }

      try {
        previewStatus = await callMcpTool(config, token, init.sessionId, "get_application_change_session_preview_status", {
          application_id: applicationId,
          session_id: sessionId,
        });
      } catch (error: unknown) {
        previewStatus = {
          error: error instanceof Error ? error.message : String(error),
        };
      }

      const rawResponses: MutableRawResponses = {
        submitRequest: {
          mcpInitialize: init.responseBody,
          listApplications,
          createSession,
          previewPrep,
        },
        artifactSelection: createSession,
        plannerOutput: sessionPlan,
        siblingInfo: previewStatus,
        siblingUrl: previewStatus,
        branchInfo: previewStatus,
      };

      const artifactDetails = extractArtifactDetails(createSession) ?? [];
      const selectedArtifactsFromDetails = artifactDetails.length > 0 ? artifactDetails.map((detail) => detail.artifact) : undefined;
      const plannerPlan =
        resolvePlannerPlan({
          submitResponse: createSession,
          plannerOutputResponse: sessionPlan,
          fallbackSources: [sessionPlan, createSession],
        });
      const artifactSelection = resolveArtifactSelectionForAssertions({
        artifactDetails,
        initialSources: [createSession],
        finalSources: [sessionPlan, createSession],
        primaryArtifactSources: [sessionPlan, createSession],
        dependentArtifactSources: [sessionPlan, createSession],
        selectedArtifactsFromDetails,
      });

      const siblingId = sessionId;
      const siblingUrl =
        extractFirstString(previewStatus, [
          ["response", "preview", "primary_url"],
          ["response", "preview_urls", "0"],
          ["response", "raw", "control", "preview_target", "primary_url"],
        ]) ??
        extractFirstString(createSession, [["base_url"]]);

      const branchName =
        extractFirstString(previewStatus, [
          ["response", "raw", "control", "root_target_identity", "branch"],
          ["response", "raw", "control", "root_target_identity", "branch_name"],
          ["response", "raw", "control", "session", "metadata", "branch_name"],
          ["response", "raw", "control", "session", "metadata", "branch"],
          ["response", "raw", "control", "session", "branch_name"],
          ["response", "raw", "control", "session", "branch"],
          ["response", "raw", "branch_name"],
          ["response", "raw", "branch"],
          ["response", "branch_name"],
          ["response", "branch"],
        ]) ??
        extractFirstString(createSession, [
          ["response", "branch_name"],
          ["response", "branch"],
          ["response", "raw", "session", "branch_name"],
          ["response", "raw", "session", "branch"],
        ]) ??
        null;

      if (scenario.deployment.require_branch_isolation && !branchName) {
        throw new Error(
          `missing-backend-field: branchName is required for branch-isolated scenario '${scenario.id}' but was not present in MCP sibling/control payloads; rawResponses=${safeStringify(rawResponses)}`,
        );
      }

      const missing: string[] = [];
      if (!artifactSelection.finalSelectedArtifacts || artifactSelection.finalSelectedArtifacts.length === 0) {
        missing.push("selectedArtifacts");
      }
      if (!artifactSelection.primaryArtifact) {
        missing.push("primaryArtifact");
      }
      if (!plannerPlan) {
        missing.push("plannerPlan");
      }
      if (!siblingId) {
        missing.push("siblingId");
      }
      if (!siblingUrl) {
        missing.push("siblingUrl");
      }
      if (!artifactSelection.dependentArtifacts) {
        missing.push("dependentArtifacts");
      }

      if (missing.length > 0) {
        throw new Error(
          `Missing required MCP protocol fields: ${missing.join(", ")}; rawResponses=${safeStringify(rawResponses)}`,
        );
      }

      const requiredSelectedArtifacts = artifactSelection.finalSelectedArtifacts as string[];
      const requiredDependentArtifacts = artifactSelection.dependentArtifacts as string[];
      const requiredSiblingUrl = siblingUrl as string;

      return {
        requestText: scenario.request,
        selectedArtifacts: requiredSelectedArtifacts,
        initialSuggestedArtifacts: artifactSelection.initialSuggestedArtifacts,
        finalSelectedArtifacts: artifactSelection.finalSelectedArtifacts,
        primaryArtifact: artifactSelection.primaryArtifact,
        dependentArtifacts: requiredDependentArtifacts,
        artifactDetails,
        plannerPlan,
        siblingId,
        siblingUrl: requiredSiblingUrl,
        branchName,
        rawResponses,
      };
    } catch (error: unknown) {
      lastError = error;
      if (attempt === maxAttempts || !isRetriableMcpTransportError(error)) {
        throw error;
      }
      await sleep(500 * attempt);
    }
  }

  throw new Error(
    `MCP protocol request failed after retries: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

function buildScenarioPlannerMetadata(scenario: ScenarioDefinition): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  if (scenario.hard_required_artifacts.length > 0) {
    metadata.required_artifacts = scenario.hard_required_artifacts;
  }
  if (scenario.hard_forbidden_artifacts.length > 0) {
    metadata.forbidden_artifacts = scenario.hard_forbidden_artifacts;
  }
  return metadata;
}

function isRetriableToolSurfaceError(error: unknown): boolean {
  if (!(error instanceof McpHttpError)) {
    return false;
  }

  if (error.status !== 503) {
    return false;
  }

  const bodyText = safeStringify(error.errorBody).toLowerCase();
  return bodyText.includes("empty_tool_surface");
}

function isRetriableMcpTransportError(error: unknown): boolean {
  if (isRetriableToolSurfaceError(error)) {
    return true;
  }
  if (error instanceof McpHttpError) {
    if ([404, 408, 425, 429, 500, 502, 503, 504].includes(error.status)) {
      return true;
    }
    const bodyText = safeStringify(error.errorBody).toLowerCase();
    return bodyText.includes("temporarily unavailable") || bodyText.includes("timeout");
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("network") ||
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("timed out") ||
    message.includes("timeout")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function initializeMcpSession(
  config: McpDevelopmentConfig,
  token: string,
): Promise<McpSessionInitResult> {
  const endpoint = "/mcp";
  const url = new URL(endpoint, config.baseUrl).toString();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "harness-init",
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: {
          name: "deal-finder-harness",
          version: "1.0.0",
        },
      },
    }),
  });

  const responseBody = await response.text().catch(() => "");
  if (!response.ok) {
    throw new McpHttpError({
      endpoint,
      status: response.status,
      errorBody: responseBody,
      message: `MCP initialize failed with status ${response.status}; raw=${responseBody.slice(0, 800)}`,
    });
  }

  const sessionId = response.headers.get("mcp-session-id");
  if (!sessionId) {
    throw new Error(`MCP initialize succeeded but mcp-session-id header is missing; raw=${responseBody.slice(0, 800)}`);
  }

  return {
    sessionId,
    responseBody,
  };
}

async function callMcpTool(
  config: McpDevelopmentConfig,
  token: string,
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const endpoint = "/mcp";
  const url = new URL(endpoint, config.baseUrl).toString();
  const requestId = `tool-${toolName}-${Date.now()}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "mcp-session-id": sessionId,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: requestId,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      },
    }),
  });

  const responseBody = await response.text().catch(() => "");
  if (!response.ok) {
    throw new McpHttpError({
      endpoint,
      status: response.status,
      errorBody: responseBody,
      message: `MCP tool '${toolName}' failed with status ${response.status}; raw=${responseBody.slice(0, 800)}`,
    });
  }

  const parsed = parseMcpStreamResponse(responseBody);
  const structured = getByPath(parsed, ["result", "structuredContent", "result"]) as
    | Record<string, unknown>
    | undefined;
  const toolResult = (structured ?? parsed) as Record<string, unknown>;

  const ok = extractBooleanFromUnknown(toolResult, [["ok"]]);
  if (!ok && toolResult.ok !== undefined) {
    const status = extractFirstNumber(toolResult, [["status_code"]]) ?? 400;
    throw new McpHttpError({
      endpoint,
      status,
      errorBody: toolResult,
      message: `MCP tool '${toolName}' reported failure; raw=${safeStringify(toolResult)}`,
    });
  }

  return toolResult;
}

function parseMcpStreamResponse(body: string): Record<string, unknown> {
  const dataLine = body
    .split(/\r?\n/)
    .find((line) => line.startsWith("data: "))
    ?.replace(/^data:\s*/, "");

  if (!dataLine) {
    throw new Error(`MCP response missing SSE data payload; raw=${body.slice(0, 800)}`);
  }

  try {
    return JSON.parse(dataLine) as Record<string, unknown>;
  } catch (error: unknown) {
    throw new Error(
      `Failed to parse MCP SSE data payload: ${error instanceof Error ? error.message : String(error)}; raw=${dataLine.slice(0, 800)}`,
    );
  }
}

function extractArtifactTitles(value: unknown): string[] | undefined {
  const paths = [
    ["response", "raw", "session", "selected_artifacts"],
    ["response", "raw", "session", "analysis", "impacted_artifacts"],
  ] as const;

  for (const path of paths) {
    const candidate = getByPath(value, path);
    if (!Array.isArray(candidate)) {
      continue;
    }

    const titles = candidate
      .map((item) => {
        if (typeof item !== "object" || item === null) {
          return undefined;
        }
        const record = item as Record<string, unknown>;
        return asNonEmptyString(record.artifact_title) ?? asNonEmptyString(record.artifact_slug);
      })
      .filter((item): item is string => Boolean(item));

    if (titles.length > 0) {
      return titles;
    }
  }

  return undefined;
}

function resolvePlannerPlan(args: {
  submitResponse: unknown;
  plannerOutputResponse: unknown;
  fallbackSources: unknown[];
}): unknown {
  const explicitPlan =
    extractFirstKnown(args.submitResponse, [
      ["plannerPlan"],
      ["planner", "plan"],
      ["planner_output", "plan"],
      ["plan", "text"],
      ["response", "raw", "control", "session", "planning", "latest_draft_plan"],
      ["response", "raw", "session", "planning", "latest_draft_plan"],
    ]) ??
    extractFirstKnown(args.plannerOutputResponse, [
      ["plannerPlan"],
      ["planner", "plan"],
      ["plan", "text"],
      ["response", "raw", "control", "session", "planning", "latest_draft_plan"],
      ["response", "raw", "session", "planning", "latest_draft_plan"],
    ]);

  if (isRealPlannerPayload(explicitPlan)) {
    return explicitPlan;
  }

  const plannerTurnText = extractPlannerTurnText(args.fallbackSources);
  if (plannerTurnText) {
    return {
      text: plannerTurnText,
      source: "planner_turns",
    };
  }

  return {
    __planner_output_missing: true,
    reason:
      "No concrete planner output found. Responses only contained prompt/schema metadata or empty planner fields.",
  };
}

function isRealPlannerPayload(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.some((item) => isRealPlannerPayload(item));
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (record.__planner_output_missing === true) {
    return false;
  }

  const plannerPrompt = record.planner_prompt as Record<string, unknown> | undefined;
  if (plannerPrompt && Object.keys(record).length === 1) {
    const pending = plannerPrompt.pending;
    const message = plannerPrompt.message;
    if ((pending === false || pending === undefined) && (typeof message !== "string" || message.trim().length === 0)) {
      return false;
    }
  }

  const textCandidates = [
    asNonEmptyString(record.text),
    asNonEmptyString(record.summary),
    asNonEmptyString(record.details),
    asNonEmptyString(record.message),
    asNonEmptyString(record.content),
  ].filter((item): item is string => Boolean(item));

  if (textCandidates.length > 0) {
    return true;
  }

  const json = safeStringify(value);
  return json !== "{}" && !json.includes('"answer_payload_schema"') && !json.includes('"response_schema"');
}

function extractPlannerTurnText(sources: unknown[]): string | null {
  for (const source of sources) {
    const turns =
      (getByPath(source, ["response", "raw", "control", "session", "planning", "turns"]) as unknown) ??
      (getByPath(source, ["response", "raw", "session", "planning", "turns"]) as unknown) ??
      (getByPath(source, ["response", "planning", "turns"]) as unknown);

    if (!Array.isArray(turns)) {
      continue;
    }

    const plannerTexts = turns
      .filter((turn) => typeof turn === "object" && turn !== null)
      .map((turn) => turn as Record<string, unknown>)
      .filter((turn) => asNonEmptyString(turn.actor) === "planner")
      .map((turn) => {
        const payload = (turn.payload ?? {}) as Record<string, unknown>;
        const kind = asNonEmptyString(turn.kind) ?? "";
        const text =
          asNonEmptyString(payload.plan) ??
          asNonEmptyString(payload.summary) ??
          asNonEmptyString(payload.message) ??
          asNonEmptyString(payload.prompt);
        if (!text) {
          return null;
        }
        if (kind === "option_set" && text.trim().length === 0) {
          return null;
        }
        return `[${kind || "planner"}] ${text}`;
      })
      .filter((item): item is string => Boolean(item));

    if (plannerTexts.length > 0) {
      return plannerTexts.join("\n");
    }
  }

  return null;
}

export function resolveArtifactSelectionForAssertions(args: {
  initialSources: readonly unknown[];
  finalSources: readonly unknown[];
  primaryArtifactSources: readonly unknown[];
  dependentArtifactSources: readonly unknown[];
  artifactDetails: readonly ArtifactSelectionDetail[];
  selectedArtifactsFromDetails?: readonly string[];
}): ArtifactSelectionResolution {
  const artifactIdToLabel = buildArtifactIdToLabelMap([...args.initialSources, ...args.finalSources]);
  const initialSuggestedArtifacts =
    extractArtifactTitlesFromSources(args.initialSources) ??
    extractFirstStringArrayFromSources(args.initialSources, [
      ["response", "selected_artifacts"],
      ["response", "change_session_handle", "artifact_scope"],
      ["selectedArtifacts"],
      ["selected_artifacts"],
      ["artifactSelection", "selectedArtifacts"],
      ["artifacts", "selected"],
    ]) ??
    (args.selectedArtifactsFromDetails && args.selectedArtifactsFromDetails.length > 0
      ? dedupeStrings([...args.selectedArtifactsFromDetails])
      : []);

  const finalFromTitles = extractArtifactTitlesFromSources(args.finalSources);
  const finalFromIdsRaw =
    extractFirstStringArrayFromSources(args.finalSources, [
      ["response", "raw", "session", "selected_artifact_ids"],
      ["response", "selected_artifact_ids"],
      ["selected_artifact_ids"],
      ["response", "selected_artifacts"],
      ["selectedArtifacts"],
      ["selected_artifacts"],
    ]) ?? [];
  const finalFromIds =
    finalFromIdsRaw.length > 0 ? dedupeStrings(finalFromIdsRaw.map((value) => artifactIdToLabel.get(value) ?? value)) : [];
  const finalSelectedArtifacts =
    (finalFromIds.length > 0
        ? dedupeStrings(finalFromIds)
        : finalFromTitles && finalFromTitles.length > 0
          ? dedupeStrings(finalFromTitles)
        : dedupeStrings(initialSuggestedArtifacts));

  const primaryArtifactRaw =
    extractFirstStringFromSources(args.primaryArtifactSources, [
      ["response", "raw", "session", "primary_artifact_id"],
      ["response", "primary_artifact_id"],
      ["primary_artifact_id"],
      ["response", "raw", "session", "selected_artifacts", "0", "artifact_title"],
      ["response", "raw", "session", "analysis", "impacted_artifacts", "0", "artifact_title"],
      ["primaryArtifact"],
      ["primary_artifact"],
      ["artifactSelection", "primaryArtifact"],
      ["artifacts", "primary"],
    ]) ?? "";
  const primaryArtifact =
    (artifactIdToLabel.get(primaryArtifactRaw) ?? primaryArtifactRaw) || finalSelectedArtifacts[0] || "";

  const dependentFromRaw =
    extractFirstStringArrayFromSources(args.dependentArtifactSources, [
      ["response", "raw", "session", "dependent_artifact_ids"],
      ["response", "dependent_artifact_ids"],
      ["dependent_artifact_ids"],
      ["dependentArtifacts"],
      ["dependent_artifacts"],
      ["artifacts", "dependent"],
    ]) ?? [];
  const dependentFromMapped = dedupeStrings(dependentFromRaw.map((value) => artifactIdToLabel.get(value) ?? value));
  const dependentArtifacts =
    dependentFromMapped.length > 0
      ? dependentFromMapped
      : finalSelectedArtifacts.filter((artifact) => artifact !== primaryArtifact);

  return {
    initialSuggestedArtifacts,
    finalSelectedArtifacts,
    primaryArtifact,
    dependentArtifacts,
  };
}

export function buildHttpMcpClient(config: McpDevelopmentConfig): McpClient {
  return new HttpMcpClient(config);
}

function resolveEndpoints(overrides: Partial<McpEndpointMap> | undefined): McpEndpointMap {
  return {
    ...DEFAULT_ENDPOINTS,
    ...overrides,
  };
}

function buildDefaultHttpClient(config: McpDevelopmentConfig): HttpClient {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(config.extraHeaders ?? {}),
  };

  return new FetchHttpClient(
    config.baseUrl,
    config.timeoutMs ?? 30_000,
    headers,
    config.authTokenProvider,
  );
}

async function requestOptionalEndpoint(
  client: HttpClient,
  endpoint: string | null | undefined,
  requestId: string | null,
  scenario: ScenarioDefinition,
): Promise<unknown> {
  if (!endpoint) {
    return null;
  }

  const response = await client.request<Record<string, unknown>>({
    method: "POST",
    path: endpoint,
    body: {
      requestId,
      scenarioId: scenario.id,
    },
  });

  if (!response.ok) {
    throw new McpHttpError({
      endpoint,
      status: response.status,
      errorBody: response.data,
      message: `Optional MCP endpoint '${endpoint}' failed with status ${response.status}; raw=${safeStringify(response.data)}`,
    });
  }

  return response.data;
}

class McpHttpError extends Error {
  readonly status: number;
  readonly errorBody: unknown;
  readonly endpoint: string;

  constructor(args: { status: number; errorBody: unknown; endpoint: string; message: string }) {
    super(args.message);
    this.name = "McpHttpError";
    this.status = args.status;
    this.errorBody = args.errorBody;
    this.endpoint = args.endpoint;
  }
}

function extractArtifactDetails(value: unknown): ArtifactSelectionDetail[] | undefined {
  const candidates = [
    ["artifactSelection", "details"],
    ["artifactSelection", "artifacts"],
    ["artifacts", "details"],
    ["artifacts", "selected"],
    ["selectedArtifacts"],
    ["selected_artifacts"],
  ] as const;

  for (const path of candidates) {
    const raw = getByPath(value, path);
    if (!Array.isArray(raw)) {
      continue;
    }

    const details = raw
      .map((item) => normalizeArtifactDetail(item))
      .filter((item): item is ArtifactSelectionDetail => item !== null);

    if (details.length > 0) {
      return details;
    }
  }

  return undefined;
}

function extractArtifactTitlesFromSources(sources: readonly unknown[]): string[] | undefined {
  for (const source of sources) {
    const titles = extractArtifactTitles(source);
    if (titles && titles.length > 0) {
      return dedupeStrings(titles);
    }
  }
  return undefined;
}

function extractFirstStringArrayFromSources(
  sources: readonly unknown[],
  paths: readonly (readonly string[])[],
): string[] | undefined {
  for (const source of sources) {
    const values = extractFirstStringArray(source, paths);
    if (values && values.length > 0) {
      return dedupeStrings(values);
    }
  }
  return undefined;
}

function extractFirstStringFromSources(
  sources: readonly unknown[],
  paths: readonly (readonly string[])[],
): string | undefined {
  for (const source of sources) {
    const value = extractFirstString(source, paths);
    if (value && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function buildArtifactIdToLabelMap(sources: readonly unknown[]): Map<string, string> {
  const map = new Map<string, string>();
  const candidatePaths = [
    ["response", "raw", "session", "selected_artifacts"],
    ["response", "selected_artifacts"],
    ["selected_artifacts"],
    ["response", "raw", "session", "analysis", "impacted_artifacts"],
    ["response", "analysis", "impacted_artifacts"],
    ["analysis", "impacted_artifacts"],
  ] as const;
  for (const source of sources) {
    for (const path of candidatePaths) {
      const rows = getByPath(source, path);
      if (!Array.isArray(rows)) {
        continue;
      }
      for (const row of rows) {
        if (typeof row !== "object" || row === null) {
          continue;
        }
        const record = row as Record<string, unknown>;
        const id = asNonEmptyString(record.artifact_id) ?? asNonEmptyString(record.artifactId);
        const label =
          asNonEmptyString(record.artifact_title) ??
          asNonEmptyString(record.artifact_slug) ??
          asNonEmptyString(record.artifact) ??
          asNonEmptyString(record.name);
        if (id && label && !map.has(id)) {
          map.set(id, label);
        }
      }
    }
  }
  return map;
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const token = String(value ?? "").trim();
    if (!token || seen.has(token)) {
      continue;
    }
    seen.add(token);
    normalized.push(token);
  }
  return normalized;
}

function normalizeArtifactDetail(value: unknown): ArtifactSelectionDetail | null {
  if (typeof value === "string" && value.length > 0) {
    return {
      artifact: value,
      rationale: null,
      dependencyReason: null,
      confidence: null,
    };
  }

  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const artifact =
    asNonEmptyString(record.artifact) ??
    asNonEmptyString(record.name) ??
    asNonEmptyString(record.artifact_id) ??
    asNonEmptyString(record.artifactId);

  if (!artifact) {
    return null;
  }

  return {
    artifact,
    rationale: asNonEmptyString(record.rationale) ?? null,
    dependencyReason:
      asNonEmptyString(record.dependency_reason) ?? asNonEmptyString(record.dependencyReason) ?? null,
    confidence: asNumber(record.confidence),
  };
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractFirstKnown(value: unknown, paths: readonly (readonly string[])[]): unknown {
  for (const path of paths) {
    const candidate = getByPath(value, path);
    if (candidate !== undefined && candidate !== null) {
      return candidate;
    }
  }
  return undefined;
}

function extractFirstString(value: unknown, paths: readonly (readonly string[])[]): string | undefined {
  for (const path of paths) {
    const candidate = getByPath(value, path);
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return undefined;
}

function extractFirstNumber(value: unknown, paths: readonly (readonly string[])[]): number | undefined {
  for (const path of paths) {
    const candidate = getByPath(value, path);
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function extractFirstStringArray(
  value: unknown,
  paths: readonly (readonly string[])[],
): string[] | undefined {
  for (const path of paths) {
    const candidate = getByPath(value, path);
    if (!Array.isArray(candidate)) {
      continue;
    }

    const parsed = candidate.filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    );
    if (parsed.length > 0) {
      return parsed;
    }
  }
  return undefined;
}

function extractBooleanFromUnknown(value: unknown, paths: readonly (readonly string[])[]): boolean {
  for (const path of paths) {
    const candidate = getByPath(value, path);
    if (typeof candidate === "boolean") {
      return candidate;
    }
  }
  return false;
}

function getByPath(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value;

  for (const segment of path) {
    if (typeof current !== "object" || current === null || !(segment in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "<unserializable>";
  }
}
