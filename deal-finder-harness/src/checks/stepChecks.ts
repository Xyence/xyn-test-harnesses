import type { UiCheck } from "../scenarios/types";
import type { CommandPaletteVerifier } from "../ui/playwright/commandPalette";
import { runCampaignCrudCheck, type StructuredCheckResult } from "./campaignCrudCheck";
import { runMapSelectionCheck } from "./mapSelectionCheck";
import { runDataSourceCrudCheck } from "./dataSourceCrudCheck";

export async function runUiCheck(
  check: UiCheck,
  uiVerifier: CommandPaletteVerifier,
): Promise<StructuredCheckResult> {
  switch (check.type) {
    case "campaign_create":
    case "campaign_update":
    case "campaign_delete":
      return runCampaignCrudCheck(check, uiVerifier);
    case "command_palette_command_present":
    case "datasource_create":
    case "datasource_update":
    case "datasource_delete":
      return runDataSourceCrudCheck(check, uiVerifier);
    case "map_select_area_resolves_properties":
      return runMapSelectionCheck(check, uiVerifier);
  }
}
