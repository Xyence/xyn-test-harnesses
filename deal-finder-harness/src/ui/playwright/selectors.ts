// Centralized Playwright selectors for Xyn UI automation.
// TODO: Replace env defaults with confirmed production selectors for your deployment.
export const UI_SELECTORS = {
  appShellRoot: process.env.XYN_SELECTOR_APP_SHELL_ROOT ?? "",
  authLoggedInMarker: process.env.XYN_SELECTOR_AUTH_LOGGED_IN_MARKER ?? "",
  commandPaletteTrigger: process.env.XYN_SELECTOR_COMMAND_PALETTE_TRIGGER ?? "",
  commandPaletteInput: process.env.XYN_SELECTOR_COMMAND_PALETTE_INPUT ?? "",
  commandPaletteResults: process.env.XYN_SELECTOR_COMMAND_PALETTE_RESULTS ?? "",
  dataSourceList: process.env.XYN_SELECTOR_DATASOURCE_LIST ?? "",
  dataSourceRow: process.env.XYN_SELECTOR_DATASOURCE_ROW ?? "",
  dataSourceToast: process.env.XYN_SELECTOR_DATASOURCE_TOAST ?? "",
} as const;

export type SelectorKey = keyof typeof UI_SELECTORS;

export function getRequiredSelector(key: SelectorKey): string {
  const selector = UI_SELECTORS[key];
  if (!selector || selector.trim().length === 0) {
    throw new Error(
      `Missing required selector '${key}'. Set XYN_SELECTOR_${toEnvSuffix(key)} in environment before running Playwright checks.`,
    );
  }
  return selector;
}

function toEnvSuffix(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toUpperCase();
}
