# flink-# Flink SQL Workbench

A VS Code extension for editing and executing Flink SQL with gateway session management.

## Features

- **Custom SQL Editor**: Enhanced editor for Flink SQL files (.flink.sql)
- **Syntax Highlighting**: Full support for Flink SQL syntax and keywords
- **Query Execution**: Execute queries directly from the editor using Flink SQL Gateway
- **Single Session Management**: Create, delete, and monitor your active Flink SQL session
- **Results Panel**: View query results in a dedicated webview panel
- **Export Capabilities**: Export results to CSV or copy to clipboard
- **VS Code Integration**: Leverages VS Code settings and commands

## Requirements

- VS Code 1.103.0 or higher
- Flink SQL Gateway running and accessible

## Extension Settings

This extension contributes the following settings:

- `flinkSqlWorkbench.gateway.host`: Flink SQL Gateway host (default: "localhost")
- `flinkSqlWorkbench.gateway.port`: Flink SQL Gateway port (default: 8083)
- `flinkSqlWorkbench.gateway.sessionName`: Default session name (default: "vscode-session")
- `flinkSqlWorkbench.gateway.timeout`: Request timeout in milliseconds (default: 30000)
- `flinkSqlWorkbench.editor.autoComplete`: Enable auto-completion for Flink SQL (default: true)
- `flinkSqlWorkbench.results.maxRows`: Maximum number of rows to display (default: 1000)

## Usage

1. **Create a Flink SQL file**: Create a new file with `.flink.sql` extension
2. **Configure Gateway**: Set your Flink SQL Gateway connection in VS Code settings
3. **Connect to Gateway**: Use the command palette or the session view to connect
4. **Manage Session**: Use the "Flink SQL Session" view in the Explorer panel to:
   - View your current active session
   - Create a new session (replaces current one)
   - Delete the current session
   - View detailed session information
5. **Write SQL**: Use the enhanced editor with syntax highlighting
6. **Execute Queries**: 
   - Click the execute button in the editor toolbar
   - Use `Ctrl+Enter` (Cmd+Enter on Mac) to execute selected text or entire file
   - Use Command Palette: "Execute Flink SQL Query"
7. **View Results**: Results appear in the dedicated Results panel
8. **Export Data**: Use toolbar buttons to export to CSV or copy to clipboard

## Commands

- `Flink SQL Workbench: Execute Query` - Execute the current SQL query
- `Flink SQL Workbench: Connect to Gateway` - Manually connect to Flink Gateway
- `Flink SQL Workbench: Disconnect from Gateway` - Disconnect from Flink Gateway
- `Flink SQL Workbench: Show Results` - Show the results panel
- `Flink SQL Workbench: Refresh Session` - Refresh the session view
- `Flink SQL Workbench: Create New Session` - Create a new Flink session (replaces current)
- `Flink SQL Workbench: Delete Current Session` - Delete the active session
- `Flink SQL Workbench: View Session Info` - View detailed session information

## Architecture

This extension is built using:
- **Custom Text Editor Provider**: For enhanced .flink.sql file editing
- **Webview Panels**: For results display and complex UI
- **Gateway Service**: For Flink SQL Gateway REST API communication
- **Monaco Editor**: For advanced SQL editing capabilities

## Development

To set up the development environment:

1. Clone the repository
2. Run `npm install` to install dependencies
3. Run `npm run watch` to start compilation in watch mode
4. Press `F5` to launch the Extension Development Host
5. Create a `.flink.sql` file to test the extension

## Known Issues

- Monaco Editor loads from CDN (requires internet connection)
- Session persistence across VS Code restarts is not implemented
- Limited SQL formatting capabilities

## Release Notes

### 0.0.1

Initial release of Flink SQL Workbench extension.

## Contributing

This extension was converted from a React-based web application to a VS Code extension architecture. Contributions welcome!

---

**Enjoy using Flink SQL Workbench!**
