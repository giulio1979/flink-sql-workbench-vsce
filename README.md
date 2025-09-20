# Flink SQL Workbench for VS Code

A comprehensive VS Code extension for editing, executing, and managing Apache Flink SQL queries with integrated gateway session management, job monitoring, and catalog exploration.

## 🚀 Features

### Core SQL Editing & Execution
- **Advanced Flink SQL Editor**: Custom editor with syntax highlighting for `.flink.sql` files
- **Query Execution**: Execute selected SQL or entire documents with real-time progress tracking
- **Batch Execution**: Execute multiple SQL statements sequentially with comprehensive reporting
- **Results Visualization**: Rich webview-based results panel with tabular data display
- **Export Capabilities**: Export query results in multiple formats

### Gateway Connection Management
- **Flink SQL Gateway Integration**: Connect to local or remote Flink SQL Gateway instances
- **Session Management**: Create, manage, and monitor Flink SQL sessions
- **Auto-Reconnection**: Intelligent reconnection with configurable keep-alive intervals
- **Authentication Support**: Basic auth, bearer tokens, and custom authentication

### Job Monitoring & Control
- **Real-time Job Monitoring**: View running, completed, failed, and cancelled jobs
- **Job Management**: Stop and cancel running jobs with confirmation dialogs
- **Job Details**: Comprehensive job information with status, duration, and metadata
- **Auto-refresh**: Configurable automatic job list refreshing

### Catalog & Metadata Exploration
- **Catalog Browser**: Explore databases, tables, and schemas in tree view
- **Table Operations**: Set active catalogs, insert table references into queries
- **Metadata Inspection**: View table structures, column types, and properties
- **Auto-refresh**: Automatic catalog updates when connecting

### Developer Experience
- **Integrated Logging**: Comprehensive logging with configurable levels
- **Error Handling**: Rich error reporting with context and suggestions
- **Keyboard Shortcuts**: Efficient shortcuts for common operations
- **Command Palette**: Full command palette integration

## 📥 Installation

### From VS Code Marketplace
1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Flink SQL Workbench"
4. Click Install

### Manual Installation
1. Download the `.vsix` file from releases
2. Open VS Code
3. Press Ctrl+Shift+P and type "Extensions: Install from VSIX"
4. Select the downloaded file

## ⚙️ Configuration

### Quick Setup
1. **Recommended**: Use a credential manager extension to store your connections securely
2. Set up your connection in the credential manager with type `flink-gateway`
3. Configure the connection ID in VS Code settings: `flinkSqlWorkbench.gateway.connectionId`

### Gateway Configuration

#### Using Credential Manager (Required)
All authentication is now handled through a credential manager extension:

```json
{
  "flinkSqlWorkbench.gateway.connectionId": "your-connection-id"
}
```

Your credential manager should have a connection configured like:
```json
{
  "id": "your-connection-id",
  "name": "Production Flink Gateway",
  "type": "flink-gateway", 
  "url": "https://flink-gateway.example.com:8083",
  "authType": "basic",
  "username": "your-username"
}
```

#### Basic Connection (No Authentication)
For development environments without authentication:
```json
{
  "flinkSqlWorkbench.gateway.url": "http://localhost:8083",
  "flinkSqlWorkbench.gateway.apiVersion": "auto",
  "flinkSqlWorkbench.gateway.timeout": 30000
}
### Session Configuration

#### Default Session Properties
```json
{
  "flinkSqlWorkbench.session.properties": {
    "execution.runtime-mode": "streaming",
    "table.exec.resource.default-parallelism": "1",
    "execution.checkpointing.interval": "10s",
    "execution.checkpointing.externalized-checkpoint-retention": "RETAIN_ON_CANCELLATION"
  }
}
```

#### Session Management
```json
{
  "flinkSqlWorkbench.session.sessionName": "my-vscode-session",
  "flinkSqlWorkbench.session.autoReconnect": true,
  "flinkSqlWorkbench.session.keepAliveInterval": 300000
}
```

### Results & Display Configuration

```json
{
  "flinkSqlWorkbench.results.maxRows": 1000,
  "flinkSqlWorkbench.results.pageSize": 100,
  "flinkSqlWorkbench.results.autoRefresh": false,
  "flinkSqlWorkbench.results.refreshInterval": 5000
}
```

### Auto-refresh Settings

```json
{
  "flinkSqlWorkbench.catalog.autoRefresh": true,
  "flinkSqlWorkbench.jobs.autoRefresh": true,
  "flinkSqlWorkbench.jobs.refreshInterval": 10000
}
```

## 🎯 Usage

### Getting Started

1. **Create a Flink SQL file**: Create a new file with `.flink.sql` extension
2. **Configure connection**: Set your Flink SQL Gateway URL in settings
3. **Connect to gateway**: Use Command Palette → "Connect to Flink Gateway"
4. **Write queries**: Start writing Flink SQL queries with syntax highlighting
5. **Execute queries**: Use Ctrl+Enter to execute selected text or entire document

### File Extensions
- `.flink.sql` - Flink SQL files with full editor support
- `.fsql` - Alternative extension for Flink SQL files

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` | Execute selected query or current line |
| `Ctrl+Shift+Enter` | Execute all queries in file |
| `F5` | Refresh active panel (jobs, catalog, sessions) |

### Command Palette Commands

#### Query Execution
- `Flink SQL: Execute Query` - Execute selected SQL or entire document
- `Flink SQL: Execute All Queries` - Execute all statements in file
- `Flink SQL: Show Query Results` - Open results panel

#### Connection Management
- `Flink SQL: Connect to Gateway` - Connect to Flink SQL Gateway
- `Flink SQL: Disconnect from Gateway` - Disconnect from gateway
- `Flink SQL: Test Connection` - Test gateway connection

#### Session Management
- `Flink SQL: Create Session` - Create new Flink session
- `Flink SQL: Delete Session` - Delete current session
- `Flink SQL: View Session Info` - Show session details
- `Flink SQL: Refresh Sessions` - Refresh session list

#### Job Management
- `Flink SQL: Refresh Jobs` - Refresh job list
- `Flink SQL: Toggle Jobs Auto Refresh` - Enable/disable auto-refresh
- `Flink SQL: Stop Job` - Gracefully stop selected job
- `Flink SQL: Cancel Job` - Force cancel selected job
- `Flink SQL: View Job Details` - Show detailed job information

#### Catalog Operations
- `Flink SQL: Refresh Catalog` - Refresh catalog tree
- `Flink SQL: Set Catalog` - Set active catalog
- `Flink SQL: Insert Table Reference` - Insert table name at cursor

### Working with Panels

#### Sessions Panel
- View active and available sessions
- Create new sessions with custom properties
- Delete unused sessions
- Monitor session health and connection status

#### Jobs Panel
- Monitor running, completed, and failed jobs
- Right-click running jobs to stop or cancel
- View job details including duration, status, and metadata
- Auto-refresh for real-time monitoring

#### Catalog Panel
- Browse catalogs, databases, and tables
- Set active catalog for queries
- Insert table references directly into editor
- View table schemas and metadata

#### Results Panel
- View query results in formatted tables
- Export results to various formats
- Handle streaming query results with auto-refresh
- Navigate large result sets with pagination

## 📋 Configuration Reference

### Gateway Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `flinkSqlWorkbench.gateway.connectionId` | string | `""` | **Required**: Connection ID from credential manager |
| `flinkSqlWorkbench.gateway.url` | string | `http://localhost:8083` | Flink SQL Gateway URL (overridden by connection) |
| `flinkSqlWorkbench.gateway.useProxy` | boolean | `false` | Use proxy for CORS issues |
| `flinkSqlWorkbench.gateway.apiVersion` | string | `auto` | API version (v1, v2, auto) |
| `flinkSqlWorkbench.gateway.timeout` | number | `30000` | Request timeout (ms) |
| `flinkSqlWorkbench.gateway.maxRetries` | number | `3` | Max retry attempts |

### Session Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `flinkSqlWorkbench.session.sessionName` | string | `vscode-session` | Default session name |
| `flinkSqlWorkbench.session.autoReconnect` | boolean | `true` | Auto-reconnect on disconnect |
| `flinkSqlWorkbench.session.keepAliveInterval` | number | `300000` | Keep-alive interval (ms) |
| `flinkSqlWorkbench.session.properties` | object | See below | Default session properties |

#### Default Session Properties
```json
{
  "execution.runtime-mode": "streaming",
  "table.exec.resource.default-parallelism": "1",
  "execution.checkpointing.interval": "10s"
}
```

### Editor Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `flinkSqlWorkbench.editor.autoComplete` | boolean | `true` | Enable auto-completion |
| `flinkSqlWorkbench.editor.autoSave` | boolean | `true` | Auto-save before execution |

### Results Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `flinkSqlWorkbench.results.maxRows` | number | `1000` | Max rows to display |
| `flinkSqlWorkbench.results.pageSize` | number | `100` | Rows per page |
| `flinkSqlWorkbench.results.autoRefresh` | boolean | `false` | Auto-refresh streaming results |
| `flinkSqlWorkbench.results.refreshInterval` | number | `5000` | Refresh interval (ms) |

### Auto-refresh Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `flinkSqlWorkbench.catalog.autoRefresh` | boolean | `false` | Auto-refresh catalog |
| `flinkSqlWorkbench.jobs.autoRefresh` | boolean | `false` | Auto-refresh jobs |
| `flinkSqlWorkbench.jobs.refreshInterval` | number | `10000` | Jobs refresh interval (ms) |

### Logging Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `flinkSqlWorkbench.logging.level` | string | `info` | Log level (trace, debug, info, warn, error) |
| `flinkSqlWorkbench.logging.enableNetworkLogging` | boolean | `false` | Enable network request logging |

### UI Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `flinkSqlWorkbench.ui.theme` | string | `auto` | Panel theme (auto, dark, light) |

## 🔧 Advanced Usage

### Custom Session Properties

You can configure Flink session properties for specific use cases:

#### Batch Processing
```json
{
  "flinkSqlWorkbench.session.properties": {
    "execution.runtime-mode": "batch",
    "table.exec.resource.default-parallelism": "4"
  }
}
```

#### Streaming with Checkpointing
```json
{
  "flinkSqlWorkbench.session.properties": {
    "execution.runtime-mode": "streaming",
    "execution.checkpointing.interval": "10s",
    "execution.checkpointing.externalized-checkpoint-retention": "RETAIN_ON_CANCELLATION",
    "state.backend": "filesystem",
    "state.checkpoints.dir": "file:///path/to/checkpoints"
  }
}
```

### Multiple Gateway Configurations

Use VS Code workspace settings for project-specific configurations:

```json
// .vscode/settings.json
{
  "flinkSqlWorkbench.gateway.url": "https://production-flink.example.com:8083",
  "flinkSqlWorkbench.gateway.authentication.apiToken": "${FLINK_API_TOKEN}",
  "flinkSqlWorkbench.session.properties": {
    "execution.runtime-mode": "streaming",
    "table.exec.resource.default-parallelism": "8"
  }
}
```

### Working with Streaming Queries

1. **Enable auto-refresh** for streaming results:
   ```json
   {
     "flinkSqlWorkbench.results.autoRefresh": true,
     "flinkSqlWorkbench.results.refreshInterval": 2000
   }
   ```

2. **Use LIMIT** for streaming queries to prevent overwhelming results:
   ```sql
   SELECT * FROM streaming_table LIMIT 100;
   ```

3. **Monitor jobs** in the Jobs panel to track streaming query status

## 🐛 Troubleshooting

### Common Issues

#### Cannot Connect to Gateway
1. Verify gateway URL in settings
2. Check that Flink SQL Gateway is running
3. Verify network connectivity and firewall settings
4. Check authentication credentials

#### Query Execution Fails
1. Check session status in Sessions panel
2. Verify SQL syntax is valid for Flink
3. Check gateway logs for detailed error messages
4. Ensure required catalogs and tables exist

#### Results Not Displaying
1. Check Results panel is open (Command: "Show Query Results")
2. Verify query completed successfully
3. Check if query returns empty result set
4. Look for errors in Output panel

#### Performance Issues
1. Reduce `results.maxRows` for large result sets
2. Disable auto-refresh for heavy queries
3. Use pagination with `results.pageSize`
4. Check network latency to gateway

### Debug Mode

Enable debug logging for troubleshooting:

```json
{
  "flinkSqlWorkbench.logging.level": "debug",
  "flinkSqlWorkbench.logging.enableNetworkLogging": true
}
```

View logs in: **View** → **Output** → **Flink SQL - Main**

## 🤝 Contributing

### Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Open in VS Code
4. Press F5 to launch Extension Development Host

### Building from Source

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode for development
npm run watch

# Package extension
npm run package
```

### Testing

```bash
# Run linting
npm run lint

# Run tests
npm test
```

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🔗 Related Projects

- [Apache Flink](https://flink.apache.org/) - Stream processing framework
- [Flink SQL Gateway](https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/table/sql-gateway/overview/) - REST API for Flink SQL

## 📝 Changelog

### Version 0.0.1
- Initial release
- Core Flink SQL editing and execution
- Gateway connection management
- Session management
- Job monitoring and control
- Catalog exploration
- Results visualization
- Comprehensive configuration options

## 🆘 Support

- **Issues**: Report bugs and feature requests on GitHub
- **Documentation**: Visit the project wiki for detailed guides
- **Community**: Join discussions in project forums

---

**Happy querying with Flink SQL! 🚀**
