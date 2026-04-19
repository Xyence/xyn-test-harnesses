export interface McpAssertionCheckResult {
  readonly passed: boolean;
  readonly details: string[];
  readonly observed: Record<string, unknown>;
}
