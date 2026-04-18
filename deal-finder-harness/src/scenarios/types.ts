import { z } from "zod";

const DeploymentSchema = z.object({
  mode: z.enum(["preview", "staging", "production"]).default("preview"),
  requires_xyn_api: z.boolean().default(false),
  require_branch_isolation: z.boolean().default(false),
  notes: z.string().optional(),
});

const PlannerExpectationsSchema = z.object({
  should_use_mcp: z.boolean().default(true),
  should_update_command_palette: z.boolean().default(true),
  may_require_core_xyn_changes: z.boolean().default(false),
  success_criteria: z.array(z.string().min(1)).min(1),
  required_phrases: z.array(z.string().min(1)).default([]),
  forbidden_phrases: z.array(z.string().min(1)).default([]),
});

const MapSelectionAreaSchema = z.object({
  north: z.number(),
  south: z.number(),
  east: z.number(),
  west: z.number(),
});

const CampaignCreateCheckSchema = z.object({
  type: z.literal("campaign_create"),
  campaign_name: z.string().min(1),
});

const CampaignUpdateCheckSchema = z.object({
  type: z.literal("campaign_update"),
  campaign_id: z.string().min(1),
  expected_field: z.string().min(1),
});

const CampaignDeleteCheckSchema = z.object({
  type: z.literal("campaign_delete"),
  campaign_id: z.string().min(1),
});

const CommandPaletteCommandPresentCheckSchema = z.object({
  type: z.literal("command_palette_command_present"),
  command_text: z.string().min(1),
});

const DataSourceCreateCheckSchema = z.object({
  type: z.literal("datasource_create"),
  datasource_name: z.string().min(1),
});

const DataSourceUpdateCheckSchema = z.object({
  type: z.literal("datasource_update"),
  datasource_id: z.string().min(1),
  expected_field: z.string().min(1),
});

const DataSourceDeleteCheckSchema = z.object({
  type: z.literal("datasource_delete"),
  datasource_id: z.string().min(1),
});

const MapSelectionCheckSchema = z.object({
  type: z.literal("map_select_area_resolves_properties"),
  area: MapSelectionAreaSchema,
  expected_min_properties: z.number().int().positive().default(1),
});

export const UiCheckSchema = z.discriminatedUnion("type", [
  CampaignCreateCheckSchema,
  CampaignUpdateCheckSchema,
  CampaignDeleteCheckSchema,
  CommandPaletteCommandPresentCheckSchema,
  DataSourceCreateCheckSchema,
  DataSourceUpdateCheckSchema,
  DataSourceDeleteCheckSchema,
  MapSelectionCheckSchema,
]);

export const ScenarioSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  request: z.string().min(1),
  allow_core_bypass: z.boolean().default(false),
  expected_artifacts: z.array(z.string().min(1)).min(1),
  expected_primary_artifact: z.string().min(1),
  optional_artifacts: z.array(z.string().min(1)).default([]),
  forbidden_artifacts: z.array(z.string().min(1)).default([]),
  accepted_dependency_reasons: z.array(z.string().min(1)).default([]),
  artifact_selection_differ_group: z.string().min(1).optional(),
  planner_expectations: PlannerExpectationsSchema,
  deployment: DeploymentSchema,
  ui_checks: z.array(UiCheckSchema).min(1),
});

export type UiCheck = z.infer<typeof UiCheckSchema>;
export type ScenarioDefinition = z.infer<typeof ScenarioSchema>;
export type MapSelectionArea = z.infer<typeof MapSelectionAreaSchema>;
