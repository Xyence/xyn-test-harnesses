import type { UiCheck } from "../scenarios/types";
import type { CommandPaletteVerifier } from "../ui/playwright/commandPalette";
import type { StructuredCheckResult } from "./campaignCrudCheck";

export async function runMapSelectionCheck(
  check: Extract<UiCheck, { type: "map_select_area_resolves_properties" }>,
  uiVerifier: CommandPaletteVerifier,
): Promise<StructuredCheckResult> {
  const result = await uiVerifier.selectMapAreaAndResolveProperties(check.area);

  if (!result.implemented) {
    return {
      checkType: check.type,
      status: "blocked",
      message: "Map selection check blocked: map view is not implemented",
      details: {
        reason: "map_view_not_implemented",
        mapMessage: result.message,
      },
    };
  }

  const passed = result.resolvedProperties.length >= check.expected_min_properties;

  return {
    checkType: check.type,
    status: passed ? "passed" : "failed",
    message: result.message,
    details: {
      resolvedProperties: result.resolvedProperties,
      expectedMinProperties: check.expected_min_properties,
    },
  };
}
