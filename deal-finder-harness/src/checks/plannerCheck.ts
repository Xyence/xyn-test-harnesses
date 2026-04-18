import type { DevelopmentRequestResult } from "../clients/mcpClient";
import type { ScenarioDefinition } from "../scenarios/types";

export interface PlannerObserved {
  readonly plannerText: string;
  readonly normalizedPlannerText: string;
  readonly requiredPhrases: readonly string[];
  readonly forbiddenPhrases: readonly string[];
  readonly missingRequiredPhrases: readonly string[];
  readonly presentForbiddenPhrases: readonly string[];
  readonly requestIntentKeywords: readonly string[];
  readonly matchedIntentKeywords: readonly string[];
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
  const normalizedPlannerText = plannerText.toLowerCase();

  const requiredPhrases =
    scenario.planner_expectations.required_phrases.length > 0
      ? scenario.planner_expectations.required_phrases
      : scenario.planner_expectations.success_criteria;

  const forbiddenPhrases = scenario.planner_expectations.forbidden_phrases;

  const missingRequiredPhrases = requiredPhrases.filter(
    (phrase) => !normalizedPlannerText.includes(phrase.toLowerCase()),
  );

  const presentForbiddenPhrases = forbiddenPhrases.filter((phrase) =>
    normalizedPlannerText.includes(phrase.toLowerCase()),
  );

  const requestIntentKeywords = buildIntentKeywords(scenario.request);
  const matchedIntentKeywords = requestIntentKeywords.filter((keyword) =>
    normalizedPlannerText.includes(keyword),
  );

  const details: string[] = [];
  if (plannerText.length > 0) {
    details.push("Planner output is non-empty");
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

  if (matchedIntentKeywords.length > 0) {
    details.push("Planner references the request intent");
  } else {
    details.push("Planner does not reference request intent keywords");
  }

  const passed =
    plannerText.length > 0 &&
    missingRequiredPhrases.length === 0 &&
    presentForbiddenPhrases.length === 0 &&
    matchedIntentKeywords.length > 0;

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
    },
  };
}

function extractPlannerText(plannerPlan: unknown): string {
  if (typeof plannerPlan === "string") {
    return plannerPlan;
  }

  if (Array.isArray(plannerPlan)) {
    return plannerPlan.map((item) => extractPlannerText(item)).filter(Boolean).join(" ");
  }

  if (typeof plannerPlan === "object" && plannerPlan !== null) {
    const candidateKeys = ["text", "plan", "summary", "details", "message", "content"] as const;
    for (const key of candidateKeys) {
      const value = (plannerPlan as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value;
      }
    }

    return JSON.stringify(plannerPlan);
  }

  return "";
}

function buildIntentKeywords(requestText: string): string[] {
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

  return [...new Set(tokens)].slice(0, 10);
}
