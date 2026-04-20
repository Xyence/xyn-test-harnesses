# Deal Finder Harness (MCP Native)

This harness executes MCP-native Deal Finder scenarios and validates structured MCP outcomes.
The default execution path does not use Playwright or command-palette UI verification.

## Scenario Schema

Each scenario YAML in `src/scenarios/*.yaml` includes:

- `id`, `title`, `request`
- `expected_artifacts`, `expected_primary_artifact`
- `planner_expectations`
- `deployment`
- `assertions`

`assertions` supports:

- `expected_operations`: list of operation names expected in MCP responses
- `expected_entities_created`: entities expected to be created (`type`, optional `id`, optional `name_contains`)
- `expected_entities_updated`: entities expected to be updated (`type`, optional `id`, optional `name_contains`)
- `expected_response_fields`: required response paths with optional equality/contains checks
- `expected_notifications`: expected notification metadata (`channel`, `event`, `message_contains`)
- `require_sibling_metadata`: when true, run sibling metadata checks
- `require_url_check`: when true, run sibling URL reachability checks

## Execution Model

For each scenario, the harness evaluates:

1. MCP planning/request success
2. Artifact selection check
3. Planner coherence check
4. Optional sibling/url checks (only when requested by scenario assertions)
5. MCP-native assertion checks:
   - campaign assertions
   - data source assertions
   - notification assertions
   - response field assertions

If MCP indicates out-of-band core setup is required, the scenario is marked blocked with a clear reason.
No quickstart or external shell fallback is executed.

## MCP Target Configuration

This harness can target a dedicated Deal Finder MCP endpoint while preserving compatibility with generic MCP env vars.

Precedence order:

1. `DEAL_FINDER_MCP_BASE_URL` over `MCP_BASE_URL`
2. `DEAL_FINDER_MCP_ENDPOINT_SUBMIT_REQUEST` over `MCP_ENDPOINT_SUBMIT_REQUEST`
3. `DEAL_FINDER_MCP_ENDPOINT_HEALTH` over `MCP_ENDPOINT_HEALTH` (default `/mcp`)
4. `DEAL_FINDER_MCP_AUDIENCE` over `MCP_ID_TOKEN_AUDIENCE`

Notes:

- `auth:mcp` and harness runtime both use the same target precedence.
- Auth is unchanged: OAuth token acquisition/caching still uses the existing token bootstrap flow and bearer-token model.
- If using `id_token` mode, audience validation uses the resolved audience value from the precedence rules above.

## Reports

- Main report: `artifacts/reports/latest.json`
- Raw MCP payload snapshots per scenario: `artifacts/reports/mcp-raw/<scenario-id>.json`
- Summary includes:
  - `artifactSelectionDifferenceViolations`: scenarios in the same differ-group selected identical artifact sets
  - `cannedPlanViolations`: near-identical planner output detected across unrelated scenarios
