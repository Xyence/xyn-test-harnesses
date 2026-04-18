import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { Page } from "playwright";
import type { MapSelectionArea } from "../../scenarios/types";
import { createBrowserSession } from "./browser";
import { verifySessionLoaded } from "./login";
import { assertAppShellLoads } from "./assertions";
import { getRequiredSelector } from "./selectors";

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
  setActiveSiblingUrl(siblingUrl: string): void;
  runCampaignCreate(campaignName: string): Promise<UiActionResult>;
  runCampaignUpdate(campaignId: string, expectedField: string): Promise<UiActionResult>;
  runCampaignDelete(campaignId: string): Promise<UiActionResult>;
  runCommandPaletteCommandPresent(commandText: string): Promise<UiActionResult>;
  runDataSourceCreate(dataSourceName: string): Promise<UiActionResult>;
  runDataSourceUpdate(dataSourceId: string, expectedField: string): Promise<UiActionResult>;
  runDataSourceDelete(dataSourceId: string): Promise<UiActionResult>;
  selectMapAreaAndResolveProperties(area: MapSelectionArea): Promise<MapSelectionResult>;
}

interface PlaywrightCommandPaletteVerifierOptions {
  readonly storageStatePath: string;
  readonly artifactsDir: string;
  readonly headless?: boolean;
  readonly navigationTimeoutMs?: number;
}

class PlaywrightCommandPaletteVerifier implements CommandPaletteVerifier {
  private activeSiblingUrl: string | null = null;

  constructor(private readonly options: PlaywrightCommandPaletteVerifierOptions) {}

  setActiveSiblingUrl(siblingUrl: string): void {
    this.activeSiblingUrl = siblingUrl;
  }

  async runCampaignCreate(_campaignName: string): Promise<UiActionResult> {
    return this.notImplementedResult("campaign_create not implemented in real verifier yet");
  }

  async runCampaignUpdate(_campaignId: string, _expectedField: string): Promise<UiActionResult> {
    return this.notImplementedResult("campaign_update not implemented in real verifier yet");
  }

  async runCampaignDelete(_campaignId: string): Promise<UiActionResult> {
    return this.notImplementedResult("campaign_delete not implemented in real verifier yet");
  }

  async runCommandPaletteCommandPresent(commandText: string): Promise<UiActionResult> {
    const diagnostics: string[] = [];
    const screenshotPaths: string[] = [];

    if (!this.activeSiblingUrl) {
      return {
        ok: false,
        message: "No sibling URL configured for command palette verification",
        stepDiagnostics: diagnostics,
        screenshotPaths,
      };
    }

    await this.ensureScreenshotsDir();

    const session = await createBrowserSession({
      storageStatePath: this.options.storageStatePath,
      headless: this.options.headless ?? true,
    });

    try {
      await session.page.goto(this.activeSiblingUrl, {
        waitUntil: "domcontentloaded",
        timeout: this.options.navigationTimeoutMs ?? 20_000,
      });
      diagnostics.push(`Opened sibling URL: ${this.activeSiblingUrl}`);

      const sessionCheck = await verifySessionLoaded(session.page);
      diagnostics.push(...sessionCheck.details);
      if (!sessionCheck.passed) {
        screenshotPaths.push(await this.captureScreenshot(session.page, "auth-session-missing"));
        return {
          ok: false,
          message: "Authenticated session verification failed",
          stepDiagnostics: diagnostics,
          screenshotPaths,
          observedState: {
            session: sessionCheck.observed,
          },
        };
      }

      const shellCheck = await assertAppShellLoads(session.page);
      diagnostics.push(...shellCheck.details);
      if (!shellCheck.passed) {
        screenshotPaths.push(await this.captureScreenshot(session.page, "app-shell-missing"));
        return {
          ok: false,
          message: "App shell did not load",
          stepDiagnostics: diagnostics,
          screenshotPaths,
          observedState: {
            appShell: shellCheck.observed,
          },
        };
      }

      const runResult = await searchCommandInPalette(session.page, commandText);
      diagnostics.push(...runResult.details);
      screenshotPaths.push(await this.captureScreenshot(session.page, "command-search"));

      if (!runResult.passed) {
        return {
          ok: false,
          message: `Command phrase '${commandText}' not found in command palette results`,
          stepDiagnostics: diagnostics,
          screenshotPaths,
          observedState: runResult.observed,
        };
      }

      return {
        ok: true,
        message: `Command phrase '${commandText}' found in command palette results`,
        stepDiagnostics: diagnostics,
        screenshotPaths,
        observedState: runResult.observed,
      };
    } catch (error: unknown) {
      screenshotPaths.push(await this.captureScreenshot(session.page, "command-search-exception").catch(() => ""));
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Command palette verification failed",
        stepDiagnostics: diagnostics,
        screenshotPaths: screenshotPaths.filter((pathValue) => pathValue.length > 0),
      };
    } finally {
      await session.close();
    }
  }

  async runDataSourceCreate(_dataSourceName: string): Promise<UiActionResult> {
    return this.notImplementedResult("datasource_create not implemented in real verifier yet");
  }

  async runDataSourceUpdate(_dataSourceId: string, _expectedField: string): Promise<UiActionResult> {
    return this.notImplementedResult("datasource_update not implemented in real verifier yet");
  }

  async runDataSourceDelete(_dataSourceId: string): Promise<UiActionResult> {
    return this.notImplementedResult("datasource_delete not implemented in real verifier yet");
  }

  async selectMapAreaAndResolveProperties(_area: MapSelectionArea): Promise<MapSelectionResult> {
    return {
      implemented: false,
      resolvedProperties: [],
      message: "map_select_area_resolves_properties not implemented in real verifier yet",
    };
  }

  private notImplementedResult(message: string): UiActionResult {
    return {
      ok: false,
      message,
      stepDiagnostics: [message],
      screenshotPaths: [],
    };
  }

  private async ensureScreenshotsDir(): Promise<void> {
    await mkdir(path.resolve(process.cwd(), this.options.artifactsDir, "screenshots"), {
      recursive: true,
    });
  }

  private async captureScreenshot(page: Page, label: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const relativePath = path.join("screenshots", `verifier-${label}-${timestamp}.png`);
    const absolutePath = path.resolve(process.cwd(), this.options.artifactsDir, relativePath);
    await page.screenshot({ path: absolutePath, fullPage: true });
    return path.join(this.options.artifactsDir, relativePath);
  }
}

export async function openCommandPalette(page: Page, timeoutMs = 10_000): Promise<boolean> {
  const paletteInputSelector = getRequiredSelector("commandPaletteInput");
  const paletteTriggerSelector = getRequiredSelector("commandPaletteTrigger");
  const modifier = process.platform === "darwin" ? "Meta" : "Control";

  await page.keyboard.press(`${modifier}+K`);
  const inputByKeyboard = await page
    .locator(paletteInputSelector)
    .first()
    .isVisible({ timeout: 1_500 })
    .catch(() => false);
  if (inputByKeyboard) {
    return true;
  }

  const trigger = page.locator(paletteTriggerSelector).first();
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click();
  }

  await page.waitForSelector(paletteInputSelector, { timeout: timeoutMs });
  return true;
}

async function searchCommandInPalette(page: Page, command: string): Promise<CommandPaletteRunResult> {
  const details: string[] = [];
  const paletteInputSelector = getRequiredSelector("commandPaletteInput");
  const paletteResultsSelector = getRequiredSelector("commandPaletteResults");

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

  const input = page.locator(paletteInputSelector).first();
  await input.fill(command);
  details.push("Filled command palette input");

  await page.waitForTimeout(600);
  const resultText = await page.locator(paletteResultsSelector).first().innerText().catch(() => "");
  const found = resultText.toLowerCase().includes(command.toLowerCase());
  details.push(found ? "Command phrase found in results" : "Command phrase not found in results");

  return {
    passed: found,
    details,
    observed: {
      command,
      paletteOpened: true,
      resultText,
    },
  };
}

export function buildPlaywrightCommandPaletteVerifier(
  options: PlaywrightCommandPaletteVerifierOptions,
): CommandPaletteVerifier {
  return new PlaywrightCommandPaletteVerifier(options);
}
