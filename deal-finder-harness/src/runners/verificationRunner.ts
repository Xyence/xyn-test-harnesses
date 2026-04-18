import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { Page } from "playwright";
import type { ScenarioDefinition } from "../scenarios/types";
import { createBrowserSession } from "../ui/playwright/browser";
import { verifySessionLoaded } from "../ui/playwright/login";
import { assertAppShellLoads } from "../ui/playwright/assertions";
import { UI_SELECTORS, openCommandPalette } from "../ui/playwright/commandPalette";

export interface VerificationRunnerConfig {
  readonly artifactsDir: string;
  readonly storageStatePath: string;
  readonly headless?: boolean;
  readonly urlTimeoutMs?: number;
}

export interface VerificationResult {
  readonly passed: boolean;
  readonly details: string[];
  readonly observed: {
    readonly scenarioId: string;
    readonly siblingUrl: string | null;
    readonly commands: readonly string[];
    readonly startedAtIso: string;
    readonly endedAtIso: string;
    readonly durationMs: number;
    readonly screenshotPaths: readonly string[];
    readonly appShellAssertion: Record<string, unknown>;
    readonly loginCheck: Record<string, unknown>;
    readonly commandResults: readonly Record<string, unknown>[];
  };
}

export class VerificationRunner {
  constructor(private readonly config: VerificationRunnerConfig) {}

  async run(scenario: ScenarioDefinition, siblingUrl: string | null): Promise<VerificationResult> {
    const startedAt = Date.now();
    const startedAtIso = new Date(startedAt).toISOString();
    const details: string[] = [];
    const screenshotPaths: string[] = [];
    const commandResults: Record<string, unknown>[] = [];
    let appShellAssertion: Record<string, unknown> = {};
    let loginCheck: Record<string, unknown> = {};

    if (!siblingUrl) {
      return {
        passed: false,
        details: ["Verification failed: sibling URL is missing"],
        observed: {
          scenarioId: scenario.id,
          siblingUrl,
          commands: [],
          startedAtIso,
          endedAtIso: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          screenshotPaths,
          appShellAssertion,
          loginCheck,
          commandResults,
        },
      };
    }

    const phraseChecks = scenario.ui_checks.filter(
      (check): check is Extract<typeof check, { type: "command_palette_command_present" }> =>
        check.type === "command_palette_command_present",
    );

    if (phraseChecks.length === 0) {
      return {
        passed: false,
        details: ["Verification failed: scenario has no command_palette_command_present check"],
        observed: {
          scenarioId: scenario.id,
          siblingUrl,
          commands: [],
          startedAtIso,
          endedAtIso: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          screenshotPaths,
          appShellAssertion,
          loginCheck,
          commandResults,
        },
      };
    }

    await mkdir(path.resolve(process.cwd(), this.config.artifactsDir, "screenshots"), {
      recursive: true,
    });

    let session: Awaited<ReturnType<typeof createBrowserSession>> | null = null;

    try {
      session = await createBrowserSession({
        storageStatePath: this.config.storageStatePath,
        headless: this.config.headless ?? true,
      });

      await session.page.goto(siblingUrl, {
        waitUntil: "domcontentloaded",
        timeout: this.config.urlTimeoutMs ?? 20_000,
      });
      details.push("Opened sibling URL");

      const sessionCheck = await verifySessionLoaded(session.page);
      loginCheck = sessionCheck.observed;
      details.push(...sessionCheck.details);

      const appShellCheck = await assertAppShellLoads(session.page);
      appShellAssertion = appShellCheck.observed;
      details.push(...appShellCheck.details);

      if (!sessionCheck.passed || !appShellCheck.passed) {
        const screenshotPath = await captureFailureScreenshot(
          session.page,
          this.config.artifactsDir,
          scenario.id,
          "shell-or-login",
        );
        screenshotPaths.push(screenshotPath);

        return {
          passed: false,
          details,
          observed: {
            scenarioId: scenario.id,
            siblingUrl,
            commands: phraseChecks.map((check) => check.command_text),
            startedAtIso,
            endedAtIso: new Date().toISOString(),
            durationMs: Date.now() - startedAt,
            screenshotPaths,
            appShellAssertion,
            loginCheck,
            commandResults,
          },
        };
      }

      for (const phraseCheck of phraseChecks) {
        const phraseResult = await verifyCommandPhrasePresent(session.page, phraseCheck.command_text);
        commandResults.push(phraseResult);
        details.push(...phraseResult.details.map((detail) => `[${phraseCheck.command_text}] ${detail}`));

        if (!phraseResult.passed) {
          const screenshotPath = await captureFailureScreenshot(
            session.page,
            this.config.artifactsDir,
            scenario.id,
            "command-phrase",
          );
          screenshotPaths.push(screenshotPath);

          return {
            passed: false,
            details,
            observed: {
              scenarioId: scenario.id,
              siblingUrl,
              commands: phraseChecks.map((check) => check.command_text),
              startedAtIso,
              endedAtIso: new Date().toISOString(),
              durationMs: Date.now() - startedAt,
              screenshotPaths,
              appShellAssertion,
              loginCheck,
              commandResults,
            },
          };
        }
      }

      return {
        passed: true,
        details,
        observed: {
          scenarioId: scenario.id,
          siblingUrl,
          commands: phraseChecks.map((check) => check.command_text),
          startedAtIso,
          endedAtIso: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          screenshotPaths,
          appShellAssertion,
          loginCheck,
          commandResults,
        },
      };
    } catch (error: unknown) {
      if (session) {
        const screenshotPath = await captureFailureScreenshot(
          session.page,
          this.config.artifactsDir,
          scenario.id,
          "exception",
        ).catch(() => "");

        if (screenshotPath) {
          screenshotPaths.push(screenshotPath);
        }
      }

      details.push(error instanceof Error ? error.message : "Unknown Playwright verification error");

      return {
        passed: false,
        details,
        observed: {
          scenarioId: scenario.id,
          siblingUrl,
          commands: phraseChecks.map((check) => check.command_text),
          startedAtIso,
          endedAtIso: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          screenshotPaths,
          appShellAssertion,
          loginCheck,
          commandResults,
        },
      };
    } finally {
      if (session) {
        await session.close();
      }
    }
  }
}

async function verifyCommandPhrasePresent(
  page: Page,
  phrase: string,
): Promise<{ passed: boolean; details: string[]; observed: Record<string, unknown> }> {
  const details: string[] = [];

  await openCommandPalette(page);
  details.push("Opened command palette");

  const input = page.locator(UI_SELECTORS.commandPaletteInput).first();
  await input.fill(phrase);
  details.push(`Entered phrase '${phrase}' into command palette`);

  // TODO: Confirm deterministic command palette result container selector.
  const resultText = await page
    .locator(UI_SELECTORS.commandPaletteResults)
    .first()
    .innerText()
    .catch(() => "");

  const found = resultText.toLowerCase().includes(phrase.toLowerCase());
  details.push(found ? "Phrase found in command palette results" : "Phrase not found in command palette results");

  return {
    passed: found,
    details,
    observed: {
      phrase,
      found,
      resultText,
    },
  };
}

async function captureFailureScreenshot(
  page: Page,
  artifactsDir: string,
  scenarioId: string,
  label: string,
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const relativePath = path.join("screenshots", `${scenarioId}-${label}-${timestamp}.png`);
  const absolutePath = path.resolve(process.cwd(), artifactsDir, relativePath);

  await page.screenshot({ path: absolutePath, fullPage: true });

  return path.join(artifactsDir, relativePath);
}
