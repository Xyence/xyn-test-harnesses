import type { Page } from "playwright";
import { UI_SELECTORS } from "./commandPalette";

export interface AssertionResult {
  readonly passed: boolean;
  readonly details: string[];
  readonly observed: Record<string, unknown>;
}

export async function assertAppShellLoads(page: Page, timeoutMs = 15_000): Promise<AssertionResult> {
  // TODO: Replace app shell selector with stable production selector from xyn-ui.
  const selector = UI_SELECTORS.appShellRoot;

  try {
    await page.waitForSelector(selector, { timeout: timeoutMs, state: "visible" });
    return {
      passed: true,
      details: ["App shell loaded"],
      observed: {
        appShellSelector: selector,
      },
    };
  } catch (error: unknown) {
    return {
      passed: false,
      details: ["App shell did not load within timeout"],
      observed: {
        appShellSelector: selector,
        error: error instanceof Error ? error.message : "Unknown app shell assertion error",
      },
    };
  }
}
