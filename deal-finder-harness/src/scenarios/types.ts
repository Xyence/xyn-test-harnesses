import { z } from "zod";

const DeploymentSchema = z.object({
  mode: z.enum(["preview", "staging", "production"]).default("preview"),
  requires_xyn_api: z.boolean().default(false),
  require_branch_isolation: z.boolean().default(false),
  notes: z.string().optional(),
});

const PlannerExpectationsSchema = z.object({
  should_use_mcp: z.boolean().default(true),
  may_require_core_xyn_changes: z.boolean().default(false),
  success_criteria: z.array(z.string().min(1)).min(1),
  required_phrases: z.array(z.string().min(1)).default([]),
  forbidden_phrases: z.array(z.string().min(1)).default([]),
});

const ExpectedEntitySchema = z.object({
  type: z.string().min(1),
  id: z.string().optional(),
  name_contains: z.string().optional(),
});

const ExpectedResponseFieldSchema = z.object({
  path: z.string().min(1),
  equals: z.union([z.string(), z.number(), z.boolean()]).optional(),
  contains: z.string().optional(),
});

const ExpectedNotificationSchema = z.object({
  channel: z.string().optional(),
  event: z.string().optional(),
  message_contains: z.string().optional(),
});

const DataSourceCrudConfigSchema = z.object({
  fixture_ids: z.array(z.string().min(1)).default([]),
  include_ingest_smoke: z.boolean().default(false),
});

const IngestionSmokeConfigSchema = z.object({
  fixture_ids: z.array(z.string().min(1)).default([]),
  require_ingest_trigger: z.boolean().default(false),
  require_status_visibility: z.boolean().default(true),
  require_quality_summary: z.boolean().default(false),
  verify_disable_enable_effect: z.boolean().default(true),
});

const McpAssertionsSchema = z.object({
  expected_operations: z.array(z.string().min(1)).default([]),
  expected_entities_created: z.array(ExpectedEntitySchema).default([]),
  expected_entities_updated: z.array(ExpectedEntitySchema).default([]),
  expected_response_fields: z.array(ExpectedResponseFieldSchema).default([]),
  expected_notifications: z.array(ExpectedNotificationSchema).default([]),
  require_sibling_metadata: z.boolean().default(false),
  require_url_check: z.boolean().default(false),
});

const ScenarioSuiteSchema = z.enum([
  "planner-regression",
  "deal-finder-mcp",
  "deal-finder-datasource-crud",
  "deal-finder-ingestion-smoke",
  "deal-finder-campaign-lifecycle",
  "deal-finder-notification-lifecycle",
  "deal-finder-ingest-ops",
  "deal-finder-campaign-notification-association",
  "deal-finder-owner-lookup",
  "deal-finder-condition-definitions",
]);

export const ScenarioSchema = z.object({
  id: z.string().min(1),
  suite: ScenarioSuiteSchema.optional(),
  title: z.string().min(1),
  request: z.string().min(1),
  expected_artifacts: z.array(z.string().min(1)).min(1),
  expected_primary_artifact: z.string().min(1),
  optional_artifacts: z.array(z.string().min(1)).default([]),
  forbidden_artifacts: z.array(z.string().min(1)).default([]),
  hard_forbidden_artifacts: z.array(z.string().min(1)).default([]),
  hard_required_artifacts: z.array(z.string().min(1)).default([]),
  target_source_files: z.array(z.string().min(1)).default([]),
  accepted_dependency_reasons: z.array(z.string().min(1)).default([]),
  artifact_selection_differ_group: z.string().min(1).optional(),
  planner_expectations: PlannerExpectationsSchema,
  deployment: DeploymentSchema,
  datasource_crud: DataSourceCrudConfigSchema.optional(),
  ingestion_smoke: IngestionSmokeConfigSchema.optional(),
  assertions: McpAssertionsSchema.default(() => ({
    expected_operations: [],
    expected_entities_created: [],
    expected_entities_updated: [],
    expected_response_fields: [],
    expected_notifications: [],
    require_sibling_metadata: false,
    require_url_check: false,
  })),
});

export type ScenarioDefinition = z.infer<typeof ScenarioSchema>;
export type ScenarioSuite = z.infer<typeof ScenarioSuiteSchema>;
export type McpAssertions = z.infer<typeof McpAssertionsSchema>;
export type ExpectedEntity = z.infer<typeof ExpectedEntitySchema>;
export type ExpectedResponseField = z.infer<typeof ExpectedResponseFieldSchema>;
export type ExpectedNotification = z.infer<typeof ExpectedNotificationSchema>;
