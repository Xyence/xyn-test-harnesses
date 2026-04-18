import type { UiCheck } from "../scenarios/types";
import type { CommandPaletteVerifier } from "../ui/playwright/commandPalette";

export interface StructuredCheckResult {
  readonly checkType: UiCheck["type"];
  readonly status: "passed" | "failed" | "blocked";
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export async function runCampaignCrudCheck(
  check: Extract<UiCheck, { type: "campaign_create" | "campaign_update" | "campaign_delete" }>,
  uiVerifier: CommandPaletteVerifier,
): Promise<StructuredCheckResult> {
  switch (check.type) {
    case "campaign_create": {
      const result = await uiVerifier.runCampaignCreate(check.campaign_name);
      return {
        checkType: check.type,
        status: result.ok ? "passed" : "failed",
        message: result.message,
        details: { snapshot: result.snapshot },
      };
    }
    case "campaign_update": {
      const result = await uiVerifier.runCampaignUpdate(check.campaign_id, check.expected_field);
      const fieldUpdated = Boolean(result.snapshot?.fields[check.expected_field]);
      return {
        checkType: check.type,
        status: result.ok && fieldUpdated ? "passed" : "failed",
        message: result.message,
        details: { snapshot: result.snapshot, fieldUpdated },
      };
    }
    case "campaign_delete": {
      const result = await uiVerifier.runCampaignDelete(check.campaign_id);
      return {
        checkType: check.type,
        status: result.ok ? "passed" : "failed",
        message: result.message,
        details: { campaignId: check.campaign_id },
      };
    }
  }
}
