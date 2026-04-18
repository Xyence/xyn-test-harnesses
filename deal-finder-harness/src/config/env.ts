import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z
    .string()
    .default("development")
    .transform((value) => value.toLowerCase())
    .pipe(z.enum(["development", "test", "production"])),
  LOG_LEVEL: z
    .string()
    .default("info")
    .transform((value) => value.toLowerCase())
    .pipe(z.enum(["debug", "info", "warn", "error"])),
  XYN_UI_BASE_URL: z.string().url(),
  MCP_SERVER_ID: z.string().min(1),
  MCP_BASE_URL: z.string().url(),
  MCP_AUTH_TOKEN: z.string().min(1),
  MCP_ENDPOINT_SUBMIT_REQUEST: z.string().min(1).default("/mcp/development/requests"),
  // TODO: Enable these when endpoint contracts are confirmed.
  MCP_ENDPOINT_ARTIFACT_SELECTION: z.string().min(1).optional(),
  MCP_ENDPOINT_PLANNER_OUTPUT: z.string().min(1).optional(),
  MCP_ENDPOINT_SIBLING_INFO: z.string().min(1).optional(),
  MCP_ENDPOINT_SIBLING_URL: z.string().min(1).optional(),
  MCP_ENDPOINT_BRANCH_INFO: z.string().min(1).optional(),
  ARTIFACTS_DIR: z.string().default("./artifacts"),
  PLAYWRIGHT_STORAGE_STATE: z.string().min(1).default("./artifacts/playwright/storage-state.json"),
  PLAYWRIGHT_HEADLESS: z
    .string()
    .optional()
    .transform((value) => (value ?? "true").toLowerCase() !== "false"),
  HARNESS_SCENARIO_ID: z.string().min(1).default("phase1_minimal_command_palette_change"),
});

export type HarnessEnv = z.infer<typeof EnvSchema>;

export function loadEnvConfig(): HarnessEnv {
  dotenv.config({ path: path.resolve(process.cwd(), ".env") });

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${message}`);
  }

  return parsed.data;
}
