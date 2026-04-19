import type { DevelopmentRequestResult } from "../clients/mcpClient";
import type { ScenarioDefinition } from "../scenarios/types";
import { collectStringValues, getByPath } from "./mcpRawUtils";
import type { McpAssertionCheckResult } from "./mcpAssertionTypes";

export function runResponseFieldCheck(
  scenario: ScenarioDefinition,
  developmentResult: DevelopmentRequestResult,
): McpAssertionCheckResult {
  const details: string[] = [];
  const allStrings = collectStringValues(developmentResult.rawResponses).map((item) => item.toLowerCase());
  const expectedOperations = scenario.assertions.expected_operations;
  const expectedResponseFields = scenario.assertions.expected_response_fields;

  const missingOperations = expectedOperations.filter((operation) => {
    const normalized = operation.toLowerCase();
    return !allStrings.some((value) => value.includes(normalized));
  });

  const missingFields = expectedResponseFields.filter((fieldExpectation) => {
    const value = getByPath(developmentResult.rawResponses, fieldExpectation.path);
    if (value === undefined || value === null) {
      return true;
    }

    if (fieldExpectation.equals !== undefined) {
      return value !== fieldExpectation.equals;
    }

    if (fieldExpectation.contains !== undefined) {
      return !String(value).toLowerCase().includes(fieldExpectation.contains.toLowerCase());
    }

    return false;
  });

  if (expectedOperations.length === 0) {
    details.push("No operation assertions expected");
  } else if (missingOperations.length === 0) {
    details.push("All expected operations were observed");
  } else {
    details.push(`Missing expected operations: ${missingOperations.join(", ")}`);
  }

  if (expectedResponseFields.length === 0) {
    details.push("No response field assertions expected");
  } else if (missingFields.length === 0) {
    details.push("All expected response fields were observed");
  } else {
    details.push(`Missing/invalid response fields: ${missingFields.map((field) => field.path).join(", ")}`);
  }

  return {
    passed: missingOperations.length === 0 && missingFields.length === 0,
    details,
    observed: {
      expectedOperations,
      missingOperations,
      expectedResponseFields,
      missingFields,
    },
  };
}
