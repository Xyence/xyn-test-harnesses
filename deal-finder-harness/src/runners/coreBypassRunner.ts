import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CoreBypassResult {
  readonly used: boolean;
  readonly authorized: boolean;
  readonly succeeded: boolean;
  readonly log: string;
  readonly command?: string;
}

export class CoreBypassRunner {
  async run(allowCoreBypass: boolean): Promise<CoreBypassResult> {
    if (!allowCoreBypass) {
      return {
        used: false,
        authorized: false,
        succeeded: false,
        log: "Core bypass was requested but scenario.allow_core_bypass is false",
      };
    }

    const command = "xynctl quickstart --force";
    console.warn(`[core-bypass] fallback triggered, executing: ${command}`);

    try {
      const { stdout, stderr } = await execFileAsync("xynctl", ["quickstart", "--force"]);
      return {
        used: true,
        authorized: true,
        succeeded: true,
        log: `${stdout}${stderr}`.trim() || "Core bypass quickstart completed successfully",
        command,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown quickstart error";
      return {
        used: true,
        authorized: true,
        succeeded: false,
        log: `Core bypass quickstart failed: ${message}`,
        command,
      };
    }
  }
}
