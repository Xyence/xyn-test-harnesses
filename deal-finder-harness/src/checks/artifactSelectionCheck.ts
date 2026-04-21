import type { ArtifactSelectionDetail, DevelopmentRequestResult } from "../clients/mcpClient";
import type { ScenarioDefinition } from "../scenarios/types";

export interface ArtifactSelectionObserved {
  readonly selectedArtifacts: readonly string[];
  readonly initialSuggestedArtifacts: readonly string[];
  readonly finalSelectedArtifacts: readonly string[];
  readonly requiredArtifacts: readonly string[];
  readonly forbiddenArtifacts: readonly string[];
  readonly optionalArtifacts: readonly string[];
  readonly acceptedDependencyReasons: readonly string[];
  readonly expectedPrimaryArtifact: string;
  readonly observedPrimaryArtifact: string;
  readonly artifactDetails: readonly ArtifactSelectionDetail[];
  readonly missingRequiredArtifacts: readonly string[];
  readonly presentForbiddenArtifacts: readonly string[];
  readonly unexpectedArtifacts: readonly string[];
  readonly unexpectedArtifactsAllowedByDependencyReason: readonly string[];
  readonly unexpectedArtifactsRejected: readonly string[];
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
  const selectedArtifacts = developmentResult.finalSelectedArtifacts;
  const selectedSet = new Set(selectedArtifacts);
  const requiredArtifacts = scenario.expected_artifacts;
  const optionalArtifacts = scenario.optional_artifacts;
  const forbiddenArtifacts = scenario.forbidden_artifacts;
  const acceptedDependencyReasons = scenario.accepted_dependency_reasons;

  const missingRequiredArtifacts = requiredArtifacts.filter((artifact) => !selectedSet.has(artifact));
  const presentForbiddenArtifacts = forbiddenArtifacts.filter((artifact) => selectedSet.has(artifact));

  const toleratedArtifacts = new Set([...requiredArtifacts, ...optionalArtifacts]);
  const unexpectedArtifacts = selectedArtifacts.filter(
    (artifact) => !toleratedArtifacts.has(artifact),
  );

  const detailByArtifact = new Map<string, ArtifactSelectionDetail>(
    developmentResult.artifactDetails.map((detail) => [detail.artifact, detail]),
  );

  const unexpectedArtifactsAllowedByDependencyReason: string[] = [];
  const unexpectedArtifactsRejected: string[] = [];

  for (const artifact of unexpectedArtifacts) {
    const dependencyReason = detailByArtifact.get(artifact)?.dependencyReason;
    if (dependencyReason && acceptedDependencyReasons.includes(dependencyReason)) {
      unexpectedArtifactsAllowedByDependencyReason.push(artifact);
    } else {
      unexpectedArtifactsRejected.push(artifact);
    }
  }

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
      `Primary artifact mismatch: expected '${scenario.expected_primary_artifact}', observed '${developmentResult.primaryArtifact}'`,
    );
  }

  if (unexpectedArtifacts.length === 0) {
    details.push("No unexpected non-optional artifacts detected");
  } else {
    details.push(`Unexpected non-optional artifacts present: ${unexpectedArtifacts.join(", ")}`);
  }

  if (unexpectedArtifactsAllowedByDependencyReason.length > 0) {
    details.push(
      `Unexpected artifacts allowed due to accepted dependency reasons: ${unexpectedArtifactsAllowedByDependencyReason.join(", ")}`,
    );
  }

  if (unexpectedArtifactsRejected.length > 0) {
    details.push(
      `Unexpected artifacts rejected (missing/unaccepted dependency reason): ${unexpectedArtifactsRejected.join(", ")}`,
    );
  }

  const passed =
    missingRequiredArtifacts.length === 0 &&
    presentForbiddenArtifacts.length === 0 &&
    developmentResult.primaryArtifact === scenario.expected_primary_artifact &&
    unexpectedArtifactsRejected.length === 0;

  return {
    passed,
    details,
    observed: {
      selectedArtifacts: developmentResult.selectedArtifacts,
      initialSuggestedArtifacts: developmentResult.initialSuggestedArtifacts,
      finalSelectedArtifacts: developmentResult.finalSelectedArtifacts,
      requiredArtifacts,
      forbiddenArtifacts,
      optionalArtifacts,
      acceptedDependencyReasons,
      expectedPrimaryArtifact: scenario.expected_primary_artifact,
      observedPrimaryArtifact: developmentResult.primaryArtifact,
      artifactDetails: developmentResult.artifactDetails,
      missingRequiredArtifacts,
      presentForbiddenArtifacts,
      unexpectedArtifacts,
      unexpectedArtifactsAllowedByDependencyReason,
      unexpectedArtifactsRejected,
    },
  };
}
