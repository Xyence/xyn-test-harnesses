import type { DevelopmentRequestResult } from "../clients/mcpClient";
import type { ScenarioDefinition } from "../scenarios/types";

export interface RuntimeIdentityExpectation {
  readonly expectedAppScope: string | null;
  readonly expectedEnvironment: string | null;
  readonly expectedBindingNames: readonly string[];
  readonly expectedRoutingMode: "path" | "host";
  readonly requireHostContext: boolean;
  readonly requireDeploymentId: boolean;
  readonly requireBuildOrImage: boolean;
}

export interface RuntimeIdentityCheckResult {
  readonly passed: boolean;
  readonly details: string[];
  readonly observed: {
    readonly expectedAppScope: string | null;
    readonly expectedEnvironment: string | null;
    readonly expectedBindingNames: readonly string[];
    readonly expectedRoutingMode: "path" | "host";
    readonly requireHostContext: boolean;
    readonly appScope: string | null;
    readonly environment: string | null;
    readonly deploymentId: string | null;
    readonly buildSha: string | null;
    readonly imageTag: string | null;
    readonly healthBindingName: string | null;
    readonly metadataBindingName: string | null;
    readonly bindingHost: string | null;
    readonly metadataBindingHost: string | null;
  };
}

export function runRuntimeIdentityCheck(
  scenario: ScenarioDefinition,
  developmentResult: DevelopmentRequestResult,
  expectation: RuntimeIdentityExpectation,
): RuntimeIdentityCheckResult {
  if (scenario.suite !== "deal-finder-mcp" && scenario.suite !== "deal-finder-datasource-crud") {
    return {
      passed: true,
      details: ["Runtime identity check not required for this suite"],
      observed: {
        expectedAppScope: expectation.expectedAppScope,
        expectedEnvironment: expectation.expectedEnvironment,
        expectedBindingNames: expectation.expectedBindingNames,
        expectedRoutingMode: expectation.expectedRoutingMode,
        requireHostContext: expectation.requireHostContext,
        appScope: null,
        environment: null,
        deploymentId: null,
        buildSha: null,
        imageTag: null,
        healthBindingName: null,
        metadataBindingName: null,
        bindingHost: null,
        metadataBindingHost: null,
      },
    };
  }

  const endpointTarget = asRecord(
    getByPath(developmentResult.rawResponses, ["submitRequest", "endpointTarget"]),
  );
  const runtimeIdentity = asRecord(
    getByPath(endpointTarget, ["runtimeIdentity", "body", "runtime_identity"]),
  );
  const metadataIdentity = asRecord(
    getByPath(endpointTarget, ["runtimeIdentityMetadata", "body", "xyn_runtime_identity"]),
  );

  const appScope = asString(runtimeIdentity.app_scope);
  const environment = asString(runtimeIdentity.environment);
  const deploymentId = asString(runtimeIdentity.deployment_id);
  const buildSha = asString(runtimeIdentity.build_sha);
  const imageTag = asString(runtimeIdentity.image_tag);
  const healthBindingName = asString(runtimeIdentity.binding_name);
  const metadataBindingName = asString(metadataIdentity.binding_name);
  const bindingHost = asString(runtimeIdentity.binding_host);
  const metadataBindingHost = asString(metadataIdentity.binding_host);

  const details: string[] = [];
  let passed = true;

  if (expectation.expectedAppScope) {
    if (appScope !== expectation.expectedAppScope) {
      passed = false;
      details.push(`app_scope mismatch: expected '${expectation.expectedAppScope}', got '${appScope ?? "null"}'`);
    } else {
      details.push("app_scope matches expected value");
    }
  }

  if (expectation.expectedEnvironment) {
    if (environment !== expectation.expectedEnvironment) {
      passed = false;
      details.push(
        `environment mismatch: expected '${expectation.expectedEnvironment}', got '${environment ?? "null"}'`,
      );
    } else {
      details.push("environment matches expected value");
    }
  }

  if (expectation.expectedBindingNames.length > 0) {
    if (!healthBindingName || !expectation.expectedBindingNames.includes(healthBindingName)) {
      passed = false;
      details.push(
        `binding_name mismatch: expected one of [${expectation.expectedBindingNames.join(", ")}], got '${
          healthBindingName ?? "null"
        }'`,
      );
    } else {
      details.push("binding_name matches approved binding set");
    }
  }

  if (expectation.requireHostContext) {
    if (!bindingHost) {
      passed = false;
      details.push("host routing expected but binding_host is missing");
    } else {
      details.push("host routing context is present (binding_host)");
    }
  }

  if (expectation.requireDeploymentId) {
    if (!deploymentId) {
      passed = false;
      details.push("deployment_id is missing or empty");
    } else {
      details.push("deployment_id is present");
    }
  }

  if (expectation.requireBuildOrImage) {
    if (!buildSha && !imageTag) {
      passed = false;
      details.push("build identity missing: neither build_sha nor image_tag is populated");
    } else {
      details.push("build identity is present (build_sha or image_tag)");
    }
  }

  if (metadataIdentity && Object.keys(metadataIdentity).length > 0) {
    const metadataAppScope = asString(metadataIdentity.app_scope);
    const metadataEnvironment = asString(metadataIdentity.environment);
    if (metadataAppScope !== appScope) {
      passed = false;
      details.push("runtime identity mismatch between health and protected-resource metadata (app_scope)");
    }
    if ((metadataEnvironment || environment) && metadataEnvironment !== environment) {
      passed = false;
      details.push("runtime identity mismatch between health and protected-resource metadata (environment)");
    }
    if (metadataBindingName && healthBindingName && metadataBindingName !== healthBindingName) {
      passed = false;
      details.push("binding_name mismatch between health and protected-resource metadata");
    } else {
      details.push("runtime identity is consistent across health and protected-resource metadata");
    }
  } else {
    details.push("protected-resource runtime identity metadata not available for consistency check");
  }

  return {
    passed,
    details,
    observed: {
      expectedAppScope: expectation.expectedAppScope,
      expectedEnvironment: expectation.expectedEnvironment,
      expectedBindingNames: expectation.expectedBindingNames,
      expectedRoutingMode: expectation.expectedRoutingMode,
      requireHostContext: expectation.requireHostContext,
      appScope,
      environment,
      deploymentId,
      buildSha,
      imageTag,
      healthBindingName,
      metadataBindingName,
      bindingHost,
      metadataBindingHost,
    },
  };
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

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}
