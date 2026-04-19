import type { DevelopmentRequestResult } from "../clients/mcpClient";
import type { ScenarioDefinition } from "../scenarios/types";
import { collectObjectsByType, collectStringValues } from "./mcpRawUtils";
import type { McpAssertionCheckResult } from "./mcpAssertionTypes";

export function runDataSourceMcpCheck(
  scenario: ScenarioDefinition,
  developmentResult: DevelopmentRequestResult,
): McpAssertionCheckResult {
  const details: string[] = [];
  const allStrings = collectStringValues(developmentResult.rawResponses).map((item) => item.toLowerCase());
  const observedDataSourceObjects = collectObjectsByType(developmentResult.rawResponses, "datasource");

  const expectedOperations = scenario.assertions.expected_operations.filter((operation) => {
    const normalized = operation.toLowerCase();
    return normalized.includes("datasource") || normalized.includes("data_source");
  });
  const expectedCreated = scenario.assertions.expected_entities_created.filter((entity) => {
    const normalized = entity.type.toLowerCase();
    return normalized.includes("datasource") || normalized.includes("data_source");
  });
  const expectedUpdated = scenario.assertions.expected_entities_updated.filter((entity) => {
    const normalized = entity.type.toLowerCase();
    return normalized.includes("datasource") || normalized.includes("data_source");
  });

  const missingOperations = expectedOperations.filter((operation) => {
    const normalized = operation.toLowerCase();
    return !allStrings.some((value) => value.includes(normalized));
  });

  function findMatch(entity: { id?: string; name_contains?: string }): boolean {
    return observedDataSourceObjects.some((candidate) => {
      const id = candidate.id;
      const name = candidate.name ?? candidate.title ?? candidate.label;
      const idMatches = typeof entity.id !== "string" || id === entity.id;
      const nameMatches =
        typeof entity.name_contains !== "string" ||
        (typeof name === "string" && name.toLowerCase().includes(entity.name_contains.toLowerCase()));
      return idMatches && nameMatches;
    });
  }

  const missingCreated = expectedCreated.filter((entity) => !findMatch(entity));
  const missingUpdated = expectedUpdated.filter((entity) => !findMatch(entity));

  if (expectedOperations.length === 0) {
    details.push("No data source operations expected");
  } else if (missingOperations.length === 0) {
    details.push("All expected data source operations were observed");
  } else {
    details.push(`Missing expected data source operations: ${missingOperations.join(", ")}`);
  }

  if (expectedCreated.length === 0) {
    details.push("No data source creation assertions expected");
  } else if (missingCreated.length === 0) {
    details.push("All expected data source creations were observed");
  } else {
    details.push(
      `Missing expected data source creations: ${missingCreated.map((entity) => entity.id ?? entity.name_contains ?? entity.type).join(", ")}`,
    );
  }

  if (expectedUpdated.length === 0) {
    details.push("No data source update assertions expected");
  } else if (missingUpdated.length === 0) {
    details.push("All expected data source updates were observed");
  } else {
    details.push(
      `Missing expected data source updates: ${missingUpdated.map((entity) => entity.id ?? entity.name_contains ?? entity.type).join(", ")}`,
    );
  }

  return {
    passed: missingOperations.length === 0 && missingCreated.length === 0 && missingUpdated.length === 0,
    details,
    observed: {
      expectedOperations,
      missingOperations,
      expectedCreated,
      missingCreated,
      expectedUpdated,
      missingUpdated,
      observedDataSourceObjectCount: observedDataSourceObjects.length,
    },
  };
}
