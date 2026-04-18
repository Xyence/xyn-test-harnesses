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
  readonly authToken: string;
  readonly timeoutMs?: number;
  readonly endpoints?: Partial<McpEndpointMap>;
  readonly extraHeaders?: Record<string, string>;
  readonly httpClient?: HttpClient;
}

export interface DevelopmentRequestResult {
  readonly requestText: string;
  readonly selectedArtifacts: readonly string[];
  readonly primaryArtifact: string;
  readonly dependentArtifacts: readonly string[];
  readonly plannerPlan: unknown;
  readonly siblingId: string;
  readonly siblingUrl: string;
  readonly branchName: string;
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

export interface McpScenarioPlanResult {
  readonly ok: boolean;
  readonly details: string;
  readonly requiresCoreXynChanges: boolean;
  readonly developmentResult?: DevelopmentRequestResult;
}

export interface McpClient {
  planScenario(scenario: ScenarioDefinition): Promise<McpScenarioPlanResult>;
}

class FetchHttpClient implements HttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly defaultHeaders: Record<string, string>,
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

    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...request.headers,
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
      return {
        ok: false,
        details: `MCP planning failed for '${scenario.id}': ${message}`,
        requiresCoreXynChanges: false,
      };
    }
  }
}

export async function submitDevelopmentRequest(
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
    },
  });

  if (!submitResponse.ok) {
    throw new Error(
      `submitRequest failed with status ${submitResponse.status}; raw=${safeStringify(submitResponse.data)}`,
    );
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

  const selectedArtifacts =
    extractFirstStringArray(submitResponse.data, [
      ["selectedArtifacts"],
      ["selected_artifacts"],
      ["artifactSelection", "selectedArtifacts"],
      ["artifacts", "selected"],
    ]) ??
    extractFirstStringArray(artifactSelectionResponse, [
      ["selectedArtifacts"],
      ["selected_artifacts"],
      ["artifacts", "selected"],
    ]);

  const primaryArtifact =
    extractFirstString(submitResponse.data, [
      ["primaryArtifact"],
      ["primary_artifact"],
      ["artifactSelection", "primaryArtifact"],
      ["artifacts", "primary"],
    ]) ??
    extractFirstString(artifactSelectionResponse, [
      ["primaryArtifact"],
      ["primary_artifact"],
      ["artifacts", "primary"],
    ]);

  const plannerPlan =
    extractFirstKnown(submitResponse.data, [
      ["plannerPlan"],
      ["planner", "plan"],
      ["planner_output"],
      ["plan"],
    ]) ?? extractFirstKnown(plannerOutputResponse, [["plannerPlan"], ["planner", "plan"], ["plan"]]);

  const siblingId =
    extractFirstString(submitResponse.data, [["siblingId"], ["sibling", "id"], ["sibling_id"]]) ??
    extractFirstString(siblingInfoResponse, [["siblingId"], ["sibling", "id"], ["sibling_id"]]);

  const siblingUrl =
    extractFirstString(submitResponse.data, [["siblingUrl"], ["sibling", "url"], ["sibling_url"]]) ??
    extractFirstString(siblingUrlResponse, [["siblingUrl"], ["sibling", "url"], ["sibling_url"]]);

  const branchName =
    extractFirstString(submitResponse.data, [["branchName"], ["branch", "name"], ["branch_name"]]) ??
    extractFirstString(branchInfoResponse, [["branchName"], ["branch", "name"], ["branch_name"]]);

  const dependentArtifacts =
    extractFirstStringArray(submitResponse.data, [
      ["dependentArtifacts"],
      ["dependent_artifacts"],
      ["artifacts", "dependent"],
    ]) ??
    extractFirstStringArray(artifactSelectionResponse, [
      ["dependentArtifacts"],
      ["dependent_artifacts"],
      ["artifacts", "dependent"],
    ]) ??
    (selectedArtifacts && primaryArtifact
      ? selectedArtifacts.filter((artifact) => artifact !== primaryArtifact)
      : undefined);

  const missing: string[] = [];
  if (!selectedArtifacts || selectedArtifacts.length === 0) {
    missing.push("selectedArtifacts");
  }
  if (!primaryArtifact) {
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
  if (!branchName) {
    missing.push("branchName");
  }
  if (!dependentArtifacts) {
    missing.push("dependentArtifacts");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required MCP fields: ${missing.join(", ")}; rawResponses=${safeStringify(rawResponses)}`,
    );
  }

  const requiredSelectedArtifacts = selectedArtifacts as string[];
  const requiredPrimaryArtifact = primaryArtifact as string;
  const requiredDependentArtifacts = dependentArtifacts as string[];
  const requiredPlannerPlan = plannerPlan as unknown;
  const requiredSiblingId = siblingId as string;
  const requiredSiblingUrl = siblingUrl as string;
  const requiredBranchName = branchName as string;

  return {
    requestText: scenario.request,
    selectedArtifacts: requiredSelectedArtifacts,
    primaryArtifact: requiredPrimaryArtifact,
    dependentArtifacts: requiredDependentArtifacts,
    plannerPlan: requiredPlannerPlan,
    siblingId: requiredSiblingId,
    siblingUrl: requiredSiblingUrl,
    branchName: requiredBranchName,
    rawResponses,
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
    authorization: `Bearer ${config.authToken}`,
    ...(config.extraHeaders ?? {}),
  };

  return new FetchHttpClient(config.baseUrl, config.timeoutMs ?? 30_000, headers);
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

  return response.data;
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
