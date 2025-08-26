# Auto-Refresh Disabled

All auto-refresh features have been disabled by default in the Flink SQL Workbench extension:

## Changes Made:

### 1. Configuration Defaults (package.json)
- `flinkSqlWorkbench.results.autoRefresh`: `false` (was already false)
- `flinkSqlWorkbench.catalog.autoRefresh`: `false` (changed from true)
- `flinkSqlWorkbench.jobs.autoRefresh`: `false` (changed from true)

### 2. JobsProvider.ts
- Changed default `autoRefresh` property from `true` to `false`
- Updated constructor to read configuration setting instead of hardcoded `true`
- Auto-refresh only starts if explicitly enabled in settings

### 3. SettingsWebviewProvider.ts
- Updated UI checkboxes to reflect new default values (unchecked by default)

## What This Means:

- **Jobs Panel**: Will not automatically refresh every 10 seconds
- **Catalog Panel**: Will not automatically refresh when connecting
- **Results Panel**: Will not automatically refresh for streaming queries
- **Manual Refresh**: All panels still support manual refresh via refresh buttons
- **User Control**: Users can still enable auto-refresh through VS Code settings if desired

## Manual Refresh Options:

- Click the refresh icon (🔄) in any panel header
- Use Command Palette: "Refresh Session", "Refresh Catalog", "Refresh Jobs"
- For jobs: Use the "Toggle Auto Refresh" command to re-enable if needed

## Benefits:

- Reduced network traffic to Flink Gateway
- Less resource usage
- Better control over when data is refreshed
- Prevents potential interference with query execution debugging
