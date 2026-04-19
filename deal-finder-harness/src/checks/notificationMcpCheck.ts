import type { DevelopmentRequestResult } from "../clients/mcpClient";
import type { ScenarioDefinition } from "../scenarios/types";
import { collectObjectsByType, collectStringValues } from "./mcpRawUtils";
import type { McpAssertionCheckResult } from "./mcpAssertionTypes";

export function runNotificationMcpCheck(
  scenario: ScenarioDefinition,
  developmentResult: DevelopmentRequestResult,
): McpAssertionCheckResult {
  const details: string[] = [];
  const allStrings = collectStringValues(developmentResult.rawResponses).map((item) => item.toLowerCase());

  const expectedOperations = scenario.assertions.expected_operations.filter((operation) =>
    operation.toLowerCase().includes("notification"),
  );
  const expectedNotifications = scenario.assertions.expected_notifications;
  const expectedCreated = scenario.assertions.expected_entities_created.filter((entity) =>
    entity.type.toLowerCase().includes("notification"),
  );
  const expectedUpdated = scenario.assertions.expected_entities_updated.filter((entity) =>
    entity.type.toLowerCase().includes("notification"),
  );

  const observedNotificationObjects = collectObjectsByType(developmentResult.rawResponses, "notification");
  const missingOperations = expectedOperations.filter((operation) => {
    const normalized = operation.toLowerCase();
    return !allStrings.some((value) => value.includes(normalized));
  });

  const missingNotificationExpectations = expectedNotifications.filter((expectation) => {
    const channelMatch =
      !expectation.channel ||
      allStrings.some((value) => value.includes(expectation.channel?.toLowerCase() ?? ""));
    const eventMatch =
      !expectation.event || allStrings.some((value) => value.includes(expectation.event?.toLowerCase() ?? ""));
    const messageMatch =
      !expectation.message_contains ||
      allStrings.some((value) => value.includes(expectation.message_contains?.toLowerCase() ?? ""));
    return !(channelMatch && eventMatch && messageMatch);
  });

  function hasEntityMatch(entity: { id?: string; name_contains?: string }): boolean {
    return observedNotificationObjects.some((candidate) => {
      const id = candidate.id;
      const name = candidate.name ?? candidate.title ?? candidate.label;
      const idMatches = typeof entity.id !== "string" || id === entity.id;
      const nameMatches =
        typeof entity.name_contains !== "string" ||
        (typeof name === "string" && name.toLowerCase().includes(entity.name_contains.toLowerCase()));
      return idMatches && nameMatches;
    });
  }

  const missingCreated = expectedCreated.filter((entity) => !hasEntityMatch(entity));
  const missingUpdated = expectedUpdated.filter((entity) => !hasEntityMatch(entity));

  if (expectedOperations.length === 0) {
    details.push("No notification operations expected");
  } else if (missingOperations.length === 0) {
    details.push("All expected notification operations were observed");
  } else {
    details.push(`Missing expected notification operations: ${missingOperations.join(", ")}`);
  }

  if (expectedNotifications.length === 0) {
    details.push("No notification content assertions expected");
  } else if (missingNotificationExpectations.length === 0) {
    details.push("All expected notifications were observed in MCP responses");
  } else {
    details.push("Missing expected notifications in MCP responses");
  }

  if (expectedCreated.length > 0 && missingCreated.length > 0) {
    details.push(
      `Missing expected notification creations: ${missingCreated.map((entity) => entity.id ?? entity.name_contains ?? entity.type).join(", ")}`,
    );
  }

  if (expectedUpdated.length > 0 && missingUpdated.length > 0) {
    details.push(
      `Missing expected notification updates: ${missingUpdated.map((entity) => entity.id ?? entity.name_contains ?? entity.type).join(", ")}`,
    );
  }

  return {
    passed:
      missingOperations.length === 0 &&
      missingNotificationExpectations.length === 0 &&
      missingCreated.length === 0 &&
      missingUpdated.length === 0,
    details,
    observed: {
      expectedOperations,
      missingOperations,
      expectedNotifications,
      missingNotificationExpectations,
      expectedCreated,
      missingCreated,
      expectedUpdated,
      missingUpdated,
      observedNotificationObjectCount: observedNotificationObjects.length,
    },
  };
}
