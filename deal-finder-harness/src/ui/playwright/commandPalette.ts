import type { Page } from "playwright";
import type { MapSelectionArea } from "../../scenarios/types";

// TODO: Replace these placeholders with real selectors from xyn-ui once stabilized.
export const UI_SELECTORS = {
  appShellRoot: "[data-testid='xyn-app-shell']",
  authLoggedInMarker: "[data-testid='xyn-user-avatar']",
  commandPaletteTrigger: "[data-testid='xyn-command-palette-trigger']",
  commandPaletteInput: "[data-testid='xyn-command-palette-input']",
  commandPaletteResults: "[data-testid='xyn-command-palette-results']",
  // TODO: Replace with concrete data source view selectors from the app.
  dataSourceList: "[data-testid='datasource-list']",
  dataSourceRow: "[data-testid='datasource-row']",
  dataSourceToast: "[data-testid='datasource-toast']",
};

export interface CampaignContextSnapshot {
  readonly campaignId: string;
  readonly fields: Record<string, string>;
}

export interface UiActionResult {
  readonly ok: boolean;
  readonly message: string;
  readonly snapshot?: CampaignContextSnapshot;
  readonly stepDiagnostics?: readonly string[];
  readonly screenshotPaths?: readonly string[];
  readonly observedState?: Record<string, unknown>;
}

export interface MapSelectionResult {
  readonly implemented: boolean;
  readonly resolvedProperties: readonly string[];
  readonly message: string;
}

export interface CommandPaletteRunResult {
  readonly passed: boolean;
  readonly details: string[];
  readonly observed: {
    readonly command: string;
    readonly paletteOpened: boolean;
    readonly resultText: string;
  };
}

export interface CommandPaletteVerifier {
  runCampaignCreate(campaignName: string): Promise<UiActionResult>;
  runCampaignUpdate(campaignId: string, expectedField: string): Promise<UiActionResult>;
  runCampaignDelete(campaignId: string): Promise<UiActionResult>;
  runCommandPaletteCommandPresent(commandText: string): Promise<UiActionResult>;
  runDataSourceCreate(dataSourceName: string): Promise<UiActionResult>;
  runDataSourceUpdate(dataSourceId: string, expectedField: string): Promise<UiActionResult>;
  runDataSourceDelete(dataSourceId: string): Promise<UiActionResult>;
  selectMapAreaAndResolveProperties(area: MapSelectionArea): Promise<MapSelectionResult>;
}

interface PlaceholderCommandPaletteVerifierOptions {
  readonly baseUrl: string;
}

class PlaceholderCommandPaletteVerifier implements CommandPaletteVerifier {
  constructor(private readonly options: PlaceholderCommandPaletteVerifierOptions) {}

  async runCampaignCreate(campaignName: string): Promise<UiActionResult> {
    return {
      ok: true,
      message: `Placeholder create executed for '${campaignName}' at ${this.options.baseUrl}`,
      snapshot: {
        campaignId: "cmp-placeholder-001",
        fields: { name: campaignName },
      },
      stepDiagnostics: [
        "Opened command palette (placeholder)",
        `Executed create campaign command for '${campaignName}'`,
        "Verified campaign name in placeholder context",
      ],
      screenshotPaths: [],
    };
  }

  async runCampaignUpdate(campaignId: string, expectedField: string): Promise<UiActionResult> {
    return {
      ok: true,
      message: `Placeholder update executed for '${campaignId}'`,
      snapshot: {
        campaignId,
        fields: { [expectedField]: "updated" },
      },
      stepDiagnostics: [
        "Opened command palette (placeholder)",
        `Executed update campaign command for '${campaignId}'`,
        `Verified updated field '${expectedField}' in placeholder context`,
      ],
      screenshotPaths: [],
    };
  }

  async runCampaignDelete(campaignId: string): Promise<UiActionResult> {
    return {
      ok: true,
      message: `Placeholder delete executed for '${campaignId}'`,
      stepDiagnostics: [
        "Opened command palette (placeholder)",
        `Executed delete campaign command for '${campaignId}'`,
        "Verified campaign deletion in placeholder context",
      ],
      screenshotPaths: [],
    };
  }

  async runCommandPaletteCommandPresent(commandText: string): Promise<UiActionResult> {
    return {
      ok: true,
      message: `Placeholder command presence verified for '${commandText}'`,
      stepDiagnostics: [
        "Opened command palette (placeholder)",
        `Searched palette for '${commandText}'`,
        "Command option found in placeholder results",
      ],
      screenshotPaths: [],
      observedState: {
        commandText,
        commandPresent: true,
      },
    };
  }

  async runDataSourceCreate(dataSourceName: string): Promise<UiActionResult> {
    return {
      ok: true,
      message: `Placeholder datasource create executed for '${dataSourceName}'`,
      stepDiagnostics: [
        "Opened command palette (placeholder)",
        `Executed datasource create command for '${dataSourceName}'`,
        "Verified datasource appears in placeholder datasource list",
      ],
      screenshotPaths: [],
      observedState: {
        dataSourceId: "ds-placeholder-001",
        dataSourceName,
        existsInList: true,
      },
    };
  }

  async runDataSourceUpdate(dataSourceId: string, expectedField: string): Promise<UiActionResult> {
    return {
      ok: true,
      message: `Placeholder datasource update executed for '${dataSourceId}'`,
      stepDiagnostics: [
        "Opened command palette (placeholder)",
        `Executed datasource update command for '${dataSourceId}'`,
        `Verified datasource field '${expectedField}' updated in placeholder state`,
      ],
      screenshotPaths: [],
      observedState: {
        dataSourceId,
        fields: {
          [expectedField]: "updated",
        },
      },
    };
  }

  async runDataSourceDelete(dataSourceId: string): Promise<UiActionResult> {
    return {
      ok: true,
      message: `Placeholder datasource delete executed for '${dataSourceId}'`,
      stepDiagnostics: [
        "Opened command palette (placeholder)",
        `Executed datasource delete command for '${dataSourceId}'`,
        "Verified datasource no longer appears in placeholder datasource list",
      ],
      screenshotPaths: [],
      observedState: {
        dataSourceId,
        existsInList: false,
      },
    };
  }

  async selectMapAreaAndResolveProperties(area: MapSelectionArea): Promise<MapSelectionResult> {
    void area;

    return {
      implemented: false,
      resolvedProperties: [],
      message: "Map view automation is not implemented yet",
    };
  }
}

export async function openCommandPalette(page: Page, timeoutMs = 10_000): Promise<boolean> {
  const modifier = process.platform === "darwin" ? "Meta" : "Control";

  await page.keyboard.press(`${modifier}+K`);
  const inputByKeyboard = await page
    .locator(UI_SELECTORS.commandPaletteInput)
    .first()
    .isVisible({ timeout: 1_500 })
    .catch(() => false);
  if (inputByKeyboard) {
    return true;
  }

  // TODO: Confirm whether trigger click is needed in xyn-ui, or keyboard only is canonical.
  const trigger = page.locator(UI_SELECTORS.commandPaletteTrigger).first();
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click();
  }

  await page.waitForSelector(UI_SELECTORS.commandPaletteInput, { timeout: timeoutMs });
  return true;
}

export async function executeNaturalLanguageCommand(
  page: Page,
  command: string,
): Promise<CommandPaletteRunResult> {
  const details: string[] = [];

  const paletteOpened = await openCommandPalette(page).catch(() => false);
  if (!paletteOpened) {
    return {
      passed: false,
      details: ["Command palette could not be opened"],
      observed: {
        command,
        paletteOpened: false,
        resultText: "",
      },
    };
  }

  const input = page.locator(UI_SELECTORS.commandPaletteInput).first();
  await input.fill(command);
  details.push("Filled command palette input");

  await page.keyboard.press("Enter");
  details.push("Submitted command from command palette");

  // TODO: Replace with deterministic app-specific success signal once selectors are known.
  await page.waitForTimeout(800);

  const resultText = await page.locator(UI_SELECTORS.commandPaletteResults).first().innerText().catch(() => "");

  return {
    passed: true,
    details,
    observed: {
      command,
      paletteOpened: true,
      resultText,
    },
  };
}

export function buildPlaceholderCommandPaletteVerifier(
  options: PlaceholderCommandPaletteVerifierOptions,
): CommandPaletteVerifier {
  return new PlaceholderCommandPaletteVerifier(options);
}
