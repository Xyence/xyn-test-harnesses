import type { UiCheck } from "../scenarios/types";
import type { CommandPaletteVerifier, UiActionResult } from "../ui/playwright/commandPalette";
import type { StructuredCheckResult } from "./campaignCrudCheck";

type DataSourceUiCheck = Extract<
  UiCheck,
  {
    type:
      | "command_palette_command_present"
      | "datasource_create"
      | "datasource_update"
      | "datasource_delete";
  }
>;

async function executeCheckAction(
  check: DataSourceUiCheck,
  uiVerifier: CommandPaletteVerifier,
): Promise<UiActionResult> {
  switch (check.type) {
    case "command_palette_command_present":
      return uiVerifier.runCommandPaletteCommandPresent(check.command_text);
    case "datasource_create":
      return uiVerifier.runDataSourceCreate(check.datasource_name);
    case "datasource_update":
      return uiVerifier.runDataSourceUpdate(check.datasource_id, check.expected_field);
    case "datasource_delete":
      return uiVerifier.runDataSourceDelete(check.datasource_id);
  }
}

function evaluateCheckState(check: DataSourceUiCheck, result: UiActionResult): boolean {
  const observed = result.observedState ?? {};

  switch (check.type) {
    case "command_palette_command_present": {
      const commandPresent = observed.commandPresent;
      return result.ok && (typeof commandPresent !== "boolean" || commandPresent);
    }
    case "datasource_create": {
      const existsInList = observed.existsInList;
      return result.ok && (typeof existsInList !== "boolean" || existsInList);
    }
    case "datasource_update": {
      const fields = observed.fields;
      const hasExpectedField =
        typeof fields === "object" && fields !== null && check.expected_field in (fields as Record<string, unknown>);
      return result.ok && hasExpectedField;
    }
    case "datasource_delete": {
      const existsInList = observed.existsInList;
      return result.ok && (typeof existsInList !== "boolean" || existsInList === false);
    }
  }
}

function buildDiagnosticDetails(check: DataSourceUiCheck, result: UiActionResult): Record<string, unknown> {
  return {
    target: getTargetIdentifier(check),
    stepDiagnostics: result.stepDiagnostics ?? [],
    screenshotPaths: result.screenshotPaths ?? [],
    observedState: result.observedState ?? {},
  };
}

function getTargetIdentifier(check: DataSourceUiCheck): string {
  switch (check.type) {
    case "command_palette_command_present":
      return check.command_text;
    case "datasource_create":
      return check.datasource_name;
    case "datasource_update":
    case "datasource_delete":
      return check.datasource_id;
  }
}

export async function runDataSourceCrudCheck(
  check: DataSourceUiCheck,
  uiVerifier: CommandPaletteVerifier,
): Promise<StructuredCheckResult> {
  const actionResult = await executeCheckAction(check, uiVerifier);
  const passed = evaluateCheckState(check, actionResult);

  return {
    checkType: check.type,
    status: passed ? "passed" : "failed",
    message: actionResult.message,
    details: buildDiagnosticDetails(check, actionResult),
  };
}
