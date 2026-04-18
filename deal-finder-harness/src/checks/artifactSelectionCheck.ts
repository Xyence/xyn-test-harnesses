import type { DevelopmentRequestResult } from "../clients/mcpClient";
import type { ScenarioDefinition } from "../scenarios/types";

export interface ArtifactSelectionObserved {
  readonly selectedArtifacts: readonly string[];
  readonly requiredArtifacts: readonly string[];
  readonly forbiddenArtifacts: readonly string[];
  readonly optionalArtifacts: readonly string[];
  readonly expectedPrimaryArtifact: string;
  readonly observedPrimaryArtifact: string | null;
  readonly missingRequiredArtifacts: readonly string[];
  readonly presentForbiddenArtifacts: readonly string[];
  readonly unexpectedArtifacts: readonly string[];
}

export interface ArtifactSelectionCheckResult {
  readonly passed: boolean;
  readonly details: string[];
  readonly observed: ArtifactSelectionObserved;
}

export function runArtifactSelectionCheck(
  scenario: ScenarioDefinition,
  developmentResult: DevelopmentRequestResult,
): ArtifactSelectionCheckResult {
  const selectedSet = new Set(developmentResult.selectedArtifacts);
  const requiredArtifacts = scenario.expected_artifacts;
  const optionalArtifacts = scenario.optional_artifacts;
  const forbiddenArtifacts = scenario.forbidden_artifacts;

  const missingRequiredArtifacts = requiredArtifacts.filter((artifact) => !selectedSet.has(artifact));
  const presentForbiddenArtifacts = forbiddenArtifacts.filter((artifact) => selectedSet.has(artifact));

  const toleratedArtifacts = new Set([...requiredArtifacts, ...optionalArtifacts]);
  const unexpectedArtifacts = developmentResult.selectedArtifacts.filter(
    (artifact) => !toleratedArtifacts.has(artifact),
  );

  const details: string[] = [];
  if (missingRequiredArtifacts.length === 0) {
    details.push("All required artifacts are present");
  } else {
    details.push(`Missing required artifacts: ${missingRequiredArtifacts.join(", ")}`);
  }

  if (presentForbiddenArtifacts.length === 0) {
    details.push("No forbidden artifacts were selected");
  } else {
    details.push(`Forbidden artifacts were selected: ${presentForbiddenArtifacts.join(", ")}`);
  }

  if (developmentResult.primaryArtifact === scenario.expected_primary_artifact) {
    details.push("Primary artifact matches expected_primary_artifact");
  } else {
    details.push(
      `Primary artifact mismatch: expected '${scenario.expected_primary_artifact}', observed '${developmentResult.primaryArtifact ?? "null"}'`,
    );
  }

  if (unexpectedArtifacts.length === 0) {
    details.push("No unexpected non-optional artifacts detected");
  } else {
    details.push(`Unexpected non-optional artifacts present: ${unexpectedArtifacts.join(", ")}`);
  }

  const passed =
    missingRequiredArtifacts.length === 0 &&
    presentForbiddenArtifacts.length === 0 &&
    developmentResult.primaryArtifact === scenario.expected_primary_artifact &&
    unexpectedArtifacts.length === 0;

  return {
    passed,
    details,
    observed: {
      selectedArtifacts: developmentResult.selectedArtifacts,
      requiredArtifacts,
      forbiddenArtifacts,
      optionalArtifacts,
      expectedPrimaryArtifact: scenario.expected_primary_artifact,
      observedPrimaryArtifact: developmentResult.primaryArtifact,
      missingRequiredArtifacts,
      presentForbiddenArtifacts,
      unexpectedArtifacts,
    },
  };
}
