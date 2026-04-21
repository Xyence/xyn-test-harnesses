import type { DevelopmentRequestResult } from "../clients/mcpClient";
import type { ScenarioDefinition } from "../scenarios/types";

const IMPLEMENTATION_MARKERS = [
  "implement",
  "update",
  "change",
  "modify",
  "add",
  "build",
  "wire",
  "integrate",
] as const;

const VALIDATION_MARKERS = [
  "validate",
  "verification",
  "verify",
  "test",
  "assert",
  "check",
  "qa",
] as const;

const DEPENDENCY_JUSTIFICATION_MARKERS = [
  "dependency",
  "depends",
  "required",
  "because",
  "needed",
  "necessary",
] as const;

const REQUIRED_PHRASE_EQUIVALENTS: Record<string, readonly string[]> = {
  discoverable: ["discoverable", "findable", "searchable", "easy to find", "natural language"],
  frontend: ["frontend", "front-end", "ui", "user interface", "workbench", "client"],
  dependency: ["dependency", "dependencies", "dependent", "depends", "required", "because"],
  "command palette": ["command palette", "palette command", "palette entry", "quick command"],
};

const UI_TOKENS = ["ui", "frontend", "front-end", "workbench", "command palette"] as const;
const API_TOKENS = ["api", "backend", "service", "endpoint"] as const;

export interface PlannerObserved {
  readonly plannerText: string;
  readonly normalizedPlannerText: string;
  readonly requiredPhrases: readonly string[];
  readonly forbiddenPhrases: readonly string[];
  readonly missingRequiredPhrases: readonly string[];
  readonly presentForbiddenPhrases: readonly string[];
  readonly requestIntentKeywords: readonly string[];
  readonly matchedIntentKeywords: readonly string[];
  readonly selectedArtifacts: readonly string[];
  readonly missingSelectedArtifactReferences: readonly string[];
  readonly widenedDependencies: readonly string[];
  readonly widenedDependencyJustificationsMissing: readonly string[];
  readonly hasImplementationSteps: boolean;
  readonly hasValidationSteps: boolean;
}

export interface PlannerCheckResult {
  readonly passed: boolean;
  readonly details: string[];
  readonly observed: PlannerObserved;
}

export function runPlannerCheck(
  scenario: ScenarioDefinition,
  developmentResult: DevelopmentRequestResult,
): PlannerCheckResult {
  const plannerText = extractPlannerText(developmentResult.plannerPlan).trim();
  const plannerAbsenceReason = extractPlannerAbsenceReason(developmentResult.plannerPlan);
  const normalizedPlannerText = normalizeText(plannerText);

  const requiredPhrases =
    scenario.planner_expectations.required_phrases.length > 0
      ? scenario.planner_expectations.required_phrases
      : scenario.planner_expectations.success_criteria;

  const forbiddenPhrases = scenario.planner_expectations.forbidden_phrases;

  const missingRequiredPhrases = requiredPhrases.filter(
    (phrase) => !matchesRequiredConcept(normalizedPlannerText, phrase),
  );

  const presentForbiddenPhrases = forbiddenPhrases.filter((phrase) =>
    normalizedPlannerText.includes(normalizeText(phrase)),
  );

  const requestIntentKeywords = buildIntentKeywords(scenario.request);
  const matchedIntentKeywords = requestIntentKeywords.filter((keyword) =>
    normalizedPlannerText.includes(keyword),
  );

  const selectedArtifacts = developmentResult.selectedArtifacts;
  const missingSelectedArtifactReferences = selectedArtifacts.filter(
    (artifact) => !matchesArtifactReference(normalizedPlannerText, artifact),
  );

  const toleratedArtifacts = new Set([...scenario.expected_artifacts, ...scenario.optional_artifacts]);
  const widenedDependencies = selectedArtifacts.filter((artifact) => !toleratedArtifacts.has(artifact));
  const widenedDependencyJustificationsMissing = widenedDependencies.filter((artifact) => {
    const detail = developmentResult.artifactDetails.find((item) => item.artifact === artifact);
    const dependencyReason = detail?.dependencyReason ? normalizeText(detail.dependencyReason) : null;
    const hasArtifactMention = normalizedPlannerText.includes(normalizeText(artifact));
    const hasReasonMention = dependencyReason ? normalizedPlannerText.includes(dependencyReason) : false;
    const hasGenericDependencyMarker = DEPENDENCY_JUSTIFICATION_MARKERS.some((marker) =>
      normalizedPlannerText.includes(marker),
    );

    return !(hasArtifactMention && (hasReasonMention || hasGenericDependencyMarker));
  });

  const hasImplementationSteps = IMPLEMENTATION_MARKERS.some((marker) => normalizedPlannerText.includes(marker));
  const hasValidationSteps = VALIDATION_MARKERS.some((marker) => normalizedPlannerText.includes(marker));

  const intentKeywordThreshold = Math.max(1, Math.min(2, requestIntentKeywords.length));

  const details: string[] = [];
  if (plannerText.length > 0) {
    details.push("Planner output is non-empty");
  } else if (plannerAbsenceReason) {
    details.push(`Planner output is missing: ${plannerAbsenceReason}`);
  } else {
    details.push("Planner output is empty");
  }

  if (missingRequiredPhrases.length === 0) {
    details.push("Planner includes all required phrases");
  } else {
    details.push(`Planner missing required phrases: ${missingRequiredPhrases.join(" | ")}`);
  }

  if (presentForbiddenPhrases.length === 0) {
    details.push("Planner excludes forbidden phrases");
  } else {
    details.push(`Planner contains forbidden phrases: ${presentForbiddenPhrases.join(" | ")}`);
  }

  if (matchedIntentKeywords.length >= intentKeywordThreshold) {
    details.push("Planner references the requested behavior change");
  } else {
    details.push("Planner does not sufficiently reference the requested behavior change");
  }

  if (missingSelectedArtifactReferences.length === 0) {
    details.push("Planner references selected artifacts");
  } else {
    details.push(
      `Planner does not reference selected artifacts: ${missingSelectedArtifactReferences.join(", ")}`,
    );
  }

  if (widenedDependencies.length === 0) {
    details.push("No widened dependencies detected");
  } else if (widenedDependencyJustificationsMissing.length === 0) {
    details.push("Planner explains why dependencies were widened");
  } else {
    details.push(
      `Planner missing widened dependency explanation for: ${widenedDependencyJustificationsMissing.join(", ")}`,
    );
  }

  if (hasImplementationSteps && hasValidationSteps) {
    details.push("Planner distinguishes implementation and validation steps");
  } else {
    details.push("Planner does not clearly distinguish implementation and validation steps");
  }

  const passed =
    plannerText.length > 0 &&
    missingRequiredPhrases.length === 0 &&
    presentForbiddenPhrases.length === 0 &&
    matchedIntentKeywords.length >= intentKeywordThreshold &&
    missingSelectedArtifactReferences.length === 0 &&
    widenedDependencyJustificationsMissing.length === 0 &&
    hasImplementationSteps &&
    hasValidationSteps;

  return {
    passed,
    details,
    observed: {
      plannerText,
      normalizedPlannerText,
      requiredPhrases,
      forbiddenPhrases,
      missingRequiredPhrases,
      presentForbiddenPhrases,
      requestIntentKeywords,
      matchedIntentKeywords,
      selectedArtifacts,
      missingSelectedArtifactReferences,
      widenedDependencies,
      widenedDependencyJustificationsMissing,
      hasImplementationSteps,
      hasValidationSteps,
    },
  };
}

export function extractPlannerText(plannerPlan: unknown): string {
  if (typeof plannerPlan === "string") {
    return plannerPlan;
  }

  if (Array.isArray(plannerPlan)) {
    return plannerPlan.map((item) => extractPlannerText(item)).filter(Boolean).join(" ");
  }

  if (typeof plannerPlan === "object" && plannerPlan !== null) {
    const record = plannerPlan as Record<string, unknown>;
    if (record.__planner_output_missing === true) {
      return "";
    }

    const plannerPrompt = record.planner_prompt as Record<string, unknown> | undefined;
    if (plannerPrompt && isEmptyPlannerPrompt(plannerPrompt) && Object.keys(record).length <= 2) {
      return "";
    }

    const candidateKeys = ["text", "plan", "summary", "details", "message", "content"] as const;
    for (const key of candidateKeys) {
      const value = record[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value;
      }
    }

    if (record.answer_payload_schema || record.response_schema) {
      return "";
    }

    return JSON.stringify(record);
  }

  return "";
}

function extractPlannerAbsenceReason(plannerPlan: unknown): string | null {
  if (typeof plannerPlan !== "object" || plannerPlan === null) {
    return null;
  }

  const record = plannerPlan as Record<string, unknown>;
  if (record.__planner_output_missing === true) {
    const reason = record.reason;
    return typeof reason === "string" && reason.trim().length > 0
      ? reason
      : "No concrete planner output was returned by MCP";
  }

  return null;
}

function isEmptyPlannerPrompt(value: Record<string, unknown>): boolean {
  const pending = value.pending;
  const message = value.message;
  const options = value.options;
  const schema = value.answer_payload_schema ?? value.response_schema;

  const hasMessage = typeof message === "string" && message.trim().length > 0;
  const hasOptions = Array.isArray(options) && options.length > 0;
  const hasSchema = typeof schema === "object" && schema !== null;

  return (pending === false || pending === undefined) && !hasMessage && !hasOptions && hasSchema;
}

export function buildIntentKeywords(requestText: string): string[] {
  const stopwords = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "from",
    "into",
    "through",
    "this",
    "will",
    "should",
    "have",
    "are",
    "not",
    "yet",
  ]);

  const tokens = requestText
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !stopwords.has(token));

  return [...new Set(tokens)].slice(0, 12);
}

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function matchesRequiredConcept(normalizedPlannerText: string, requiredPhrase: string): boolean {
  const normalizedPhrase = normalizeText(requiredPhrase);
  if (normalizedPlannerText.includes(normalizedPhrase)) {
    return true;
  }
  if (normalizedPhrase === "ui only") {
    const hasUiSignal = UI_TOKENS.some((token) => normalizedPlannerText.includes(token));
    const hasApiSignal = API_TOKENS.some((token) => normalizedPlannerText.includes(token));
    const hasApiNegationSignal =
      normalizedPlannerText.includes("api behavior unchanged") ||
      normalizedPlannerText.includes("keep api unchanged") ||
      normalizedPlannerText.includes("no backend changes") ||
      normalizedPlannerText.includes("without backend changes") ||
      normalizedPlannerText.includes("do not modify api") ||
      normalizedPlannerText.includes("do not change api") ||
      normalizedPlannerText.includes("without changing api");
    if (hasUiSignal && hasApiSignal && hasApiNegationSignal) {
      return true;
    }
    return hasUiSignal && !hasApiSignal;
  }
  const equivalents = REQUIRED_PHRASE_EQUIVALENTS[normalizedPhrase];
  if (!equivalents || equivalents.length === 0) {
    return false;
  }
  return equivalents.some((phrase) => normalizedPlannerText.includes(normalizeText(phrase)));
}

function matchesArtifactReference(normalizedPlannerText: string, artifact: string): boolean {
  const normalizedArtifact = normalizeText(artifact);
  if (!normalizedArtifact) {
    return false;
  }
  if (normalizedPlannerText.includes(normalizedArtifact)) {
    return true;
  }
  if (normalizedArtifact === "xyn-ui") {
    return UI_TOKENS.some((token) => normalizedPlannerText.includes(token));
  }
  if (normalizedArtifact === "xyn-api") {
    return API_TOKENS.some((token) => normalizedPlannerText.includes(token));
  }
  return false;
}
