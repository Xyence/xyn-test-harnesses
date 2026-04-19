import type { DevelopmentRequestResult } from "../clients/mcpClient";
import type { ScenarioDefinition } from "../scenarios/types";
import { collectObjectsByType, collectStringValues } from "./mcpRawUtils";
import type { McpAssertionCheckResult } from "./mcpAssertionTypes";

export function runCampaignMcpCheck(
  scenario: ScenarioDefinition,
  developmentResult: DevelopmentRequestResult,
): McpAssertionCheckResult {
  const details: string[] = [];
  const allStrings = collectStringValues(developmentResult.rawResponses).map((item) => item.toLowerCase());

  const campaignOperationExpectations = scenario.assertions.expected_operations.filter((operation) =>
    operation.toLowerCase().includes("campaign"),
  );
  const campaignCreateExpectations = scenario.assertions.expected_entities_created.filter((entity) =>
    entity.type.toLowerCase().includes("campaign"),
  );
  const campaignUpdateExpectations = scenario.assertions.expected_entities_updated.filter((entity) =>
    entity.type.toLowerCase().includes("campaign"),
  );

  const observedCampaignObjects = collectObjectsByType(developmentResult.rawResponses, "campaign");

  const missingOperations = campaignOperationExpectations.filter((operation) => {
    const normalized = operation.toLowerCase();
    return !allStrings.some((value) => value.includes(normalized));
  });

  const missingCreates = campaignCreateExpectations.filter((entity) => {
    return !observedCampaignObjects.some((candidate) => {
      const id = candidate.id;
      const name = candidate.name ?? candidate.title ?? candidate.label;
      const idMatches = typeof entity.id !== "string" || id === entity.id;
      const nameMatches =
        typeof entity.name_contains !== "string" ||
        (typeof name === "string" && name.toLowerCase().includes(entity.name_contains.toLowerCase()));
      return idMatches && nameMatches;
    });
  });

  const missingUpdates = campaignUpdateExpectations.filter((entity) => {
    return !observedCampaignObjects.some((candidate) => {
      const id = candidate.id;
      const name = candidate.name ?? candidate.title ?? candidate.label;
      const idMatches = typeof entity.id !== "string" || id === entity.id;
      const nameMatches =
        typeof entity.name_contains !== "string" ||
        (typeof name === "string" && name.toLowerCase().includes(entity.name_contains.toLowerCase()));
      return idMatches && nameMatches;
    });
  });

  if (campaignOperationExpectations.length === 0) {
    details.push("No campaign operations expected");
  } else if (missingOperations.length === 0) {
    details.push("All expected campaign operations were observed");
  } else {
    details.push(`Missing expected campaign operations: ${missingOperations.join(", ")}`);
  }

  if (campaignCreateExpectations.length === 0) {
    details.push("No campaign creation assertions expected");
  } else if (missingCreates.length === 0) {
    details.push("All expected campaign creations were observed");
  } else {
    details.push(
      `Missing expected campaign creations: ${missingCreates.map((entity) => entity.id ?? entity.name_contains ?? entity.type).join(", ")}`,
    );
  }

  if (campaignUpdateExpectations.length === 0) {
    details.push("No campaign update assertions expected");
  } else if (missingUpdates.length === 0) {
    details.push("All expected campaign updates were observed");
  } else {
    details.push(
      `Missing expected campaign updates: ${missingUpdates.map((entity) => entity.id ?? entity.name_contains ?? entity.type).join(", ")}`,
    );
  }

  const passed = missingOperations.length === 0 && missingCreates.length === 0 && missingUpdates.length === 0;

  return {
    passed,
    details,
    observed: {
      expectedOperations: campaignOperationExpectations,
      missingOperations,
      expectedCreated: campaignCreateExpectations,
      missingCreated: missingCreates,
      expectedUpdated: campaignUpdateExpectations,
      missingUpdated: missingUpdates,
      observedCampaignObjectCount: observedCampaignObjects.length,
    },
  };
}
