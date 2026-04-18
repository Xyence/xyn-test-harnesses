import type { DevelopmentRequestResult } from "../clients/mcpClient";
import type { ScenarioDefinition } from "../scenarios/types";

export interface SiblingCheckResult {
  readonly passed: boolean;
  readonly details: string[];
  readonly observed: {
    readonly siblingId: string | null;
    readonly siblingUrl: string | null;
    readonly branchName: string | null;
    readonly requireBranchIsolation: boolean;
    readonly missingFields: readonly string[];
  };
}

export function runSiblingCheck(
  scenario: ScenarioDefinition,
  developmentResult: DevelopmentRequestResult,
): SiblingCheckResult {
  const requireBranchIsolation = scenario.deployment.require_branch_isolation;
  const missingFields: string[] = [];
  const details: string[] = [];

  if (developmentResult.siblingId) {
    details.push("siblingId is present");
  } else {
    details.push("siblingId is missing");
    missingFields.push("siblingId");
  }

  if (developmentResult.siblingUrl) {
    details.push("siblingUrl is present");
  } else {
    details.push("siblingUrl is missing");
    missingFields.push("siblingUrl");
  }

  if (developmentResult.branchName) {
    details.push("branchName is present");
  } else if (requireBranchIsolation) {
    details.push("branchName is missing while branch isolation is required");
    missingFields.push("branchName");
  } else {
    details.push("branchName is missing but branch isolation is not required");
  }

  return {
    passed: missingFields.length === 0,
    details,
    observed: {
      siblingId: developmentResult.siblingId,
      siblingUrl: developmentResult.siblingUrl,
      branchName: developmentResult.branchName,
      requireBranchIsolation,
      missingFields,
    },
  };
}
