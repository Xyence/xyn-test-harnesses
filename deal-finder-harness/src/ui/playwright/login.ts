import type { Page } from "playwright";
import { UI_SELECTORS } from "./commandPalette";

export interface LoginCheckResult {
  readonly passed: boolean;
  readonly details: string[];
  readonly observed: {
    readonly markerSelector: string;
    readonly markerVisible: boolean;
  };
}

export async function verifySessionLoaded(page: Page, timeoutMs = 8_000): Promise<LoginCheckResult> {
  // TODO: Replace marker selector with the canonical authenticated session marker in xyn-ui.
  const markerSelector = UI_SELECTORS.authLoggedInMarker;

  const markerVisible = await page
    .locator(markerSelector)
    .first()
    .isVisible({ timeout: timeoutMs })
    .catch(() => false);

  if (markerVisible) {
    return {
      passed: true,
      details: ["Stored browser session appears to be loaded"],
      observed: {
        markerSelector,
        markerVisible,
      },
    };
  }

  return {
    passed: false,
    details: ["Stored browser session marker not found"],
    observed: {
      markerSelector,
      markerVisible,
    },
  };
}
