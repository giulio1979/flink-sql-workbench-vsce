
# Credential Manager Extension

This VS Code extension provides centralized management of connections and credentials for Kafka-related services. It allows users to store and manage connection configurations securely, which can then be accessed by other Kafka extensions.

## How to Access

The Credential Manager can be accessed through multiple ways:

### 1. Status Bar Button
- Click the "$(organization) Connections" button in the status bar

### 2. Command Palette
- Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
- Type "Credential Manager" or "Connection"
- Select from available commands

### 3. Keyboard Shortcut
- Press `Ctrl+Shift+C` (or `Cmd+Shift+C` on Mac)

### 4. Context Menus
- **Explorer**: Right-click in the Explorer sidebar
- **Editor**: Right-click in any editor window

### 5. Status Bar Indicator
- Click the window indicator area in the status bar

## Supported Connection Types

The Credential Manager supports the following connection types for different Kafka ecosystem services:

### 🔌 Kafka Connect
**Type**: `connect`
**Purpose**: Manage Apache Kafka Connect clusters
**Use Cases**:
- Deploy and manage Kafka Connect connectors
- Monitor connector status and health
- Configure source and sink connectors
**Typical URLs**:
- `http://localhost:8083` (local development)
- `https://connect.example.com:8083` (production)
**Authentication**: Basic Auth or Bearer Token

### 📊 Schema Registry
**Type**: `schema-registry`
**Purpose**: Manage Apache Kafka Schema Registry
**Use Cases**:
- Register and version Avro schemas
- Validate schema compatibility
- Manage subject lifecycles
**Typical URLs**:
- `http://localhost:8081` (local development)
- `https://schema-registry.example.com:8081` (production)
**Authentication**: Basic Auth or Bearer Token

### ⚡ Flink Gateway
**Type**: `flink-gateway`
**Purpose**: Connect to Apache Flink SQL Gateway
**Use Cases**:
- Execute Flink SQL queries
- Manage Flink jobs and sessions
- Monitor Flink cluster operations
**Typical URLs**:
- `http://localhost:8083` (local development)
- `https://flink-gateway.example.com:8083` (production)
**Authentication**: Basic Auth or Bearer Token

## Connection Configuration

Each connection supports the following authentication methods:

### 🔓 None
- No authentication required
- Suitable for development environments
- Not recommended for production

### 🔐 Basic Authentication
- Username and password
- Standard HTTP Basic Auth
- Credentials stored securely

### 🎫 Bearer Token
- JWT or API token authentication
- Single token for authentication
- Token stored securely in VS Code's encrypted storage

## Extending Connection Types

The Credential Manager is designed to be extensible. To add support for new connection types:

### 1. Update the Type Definition
```typescript
// In src/connectionStore.ts
export type ConnectionType = 'connect' | 'schema-registry' | 'flink-gateway' | 'your-new-type';
```

### 2. Add UI Support
```typescript
// In src/webviews/connectionManager.ts
<option value="your-new-type">Your Service Name</option>
```

### 3. Update Display Logic
```typescript
// In src/webviews/connectionManager.ts
c.type === 'connect' ? '🔌 Kafka Connect' :
c.type === 'schema-registry' ? '📊 Schema Registry' :
c.type === 'flink-gateway' ? '⚡ Flink Gateway' :
'🎯 Your Service Name'
```

### 4. Update Documentation
Add the new connection type to this README with:
- Service description and use cases
- Typical URLs and ports
- Authentication requirements

## For Extension Developers

Other VS Code extensions can integrate with the Credential Manager to access stored connections and credentials.

### TypeScript Interface

```typescript
export type ConnectionType = 'connect' | 'schema-registry' | 'flink-gateway';

export interface ConnectionMeta {
  id: string;           // Unique identifier
  name: string;         // Display name
  url: string;          // Base URL for the service
  type: ConnectionType; // Connection type
  authType?: 'none' | 'basic' | 'bearer';  // Authentication type
  username?: string;    // Username for basic auth
}
```

### Connection Types

- **`connect`**: Apache Kafka Connect clusters
- **`schema-registry`**: Apache Kafka Schema Registry
- **`flink-gateway`**: Apache Flink SQL Gateway

## Data Storage Locations

The Credential Manager stores data in two different locations for security and accessibility:

### Connection Metadata (Non-sensitive data)
**Location**: VS Code Workspace Settings
- **File**: `settings.json` in workspace `.vscode` folder
- **Key**: `credentialManager.connections`
- **Content**: Connection names, URLs, types, auth types, and usernames
- **Accessibility**: User-visible and editable through VS Code settings

### Secrets (Passwords/Tokens)
**Location**: VS Code Secret Storage (encrypted)
- **Storage**: Platform-specific secure storage
- **Key Format**: `credentialManager.secret.{connectionId}`
- **Content**: Passwords, bearer tokens, and other sensitive credentials
- **Accessibility**: Encrypted and only accessible through VS Code APIs

## Platform-Specific Storage Locations

### Windows
- **Workspace Settings**: `%WORKSPACE%\.vscode\settings.json`
- **Secret Storage**: Windows Credential Manager (encrypted)
  - Service: `vscodevscode.github-authentication`
  - Individual secrets stored with unique identifiers

### macOS
- **Workspace Settings**: `WORKSPACE/.vscode/settings.json`
- **Secret Storage**: macOS Keychain
  - Service: `vscodevscode.github-authentication`
  - Stored in user's login keychain

### Linux
- **Workspace Settings**: `WORKSPACE/.vscode/settings.json`
- **Secret Storage**: GNOME Keyring or KWallet (depending on desktop environment)
  - Service: `vscodevscode.github-authentication`

### Code Server (Remote Development)
- **Workspace Settings**: Same as local VS Code (workspace `.vscode/settings.json`)
- **Secret Storage**: Server-side encrypted storage
  - Location: `~/.vscode-server/data/User/globalStorage/`
  - File: Encrypted secrets database
  - Only accessible through VS Code Server APIs

## Security Notes

- **Connection metadata** is stored in plain JSON in workspace settings for easy backup and sharing
- **Secrets** are encrypted using platform-specific secure storage mechanisms
- **Migration support** exists for legacy insecure storage (base64 passwords in settings)
- **Automatic migration** occurs when accessing legacy passwords
- **No plaintext passwords** are ever stored in workspace settings

## Accessing Stored Data

### Connection Metadata
```typescript
const config = vscode.workspace.getConfiguration();
const connections = config.get('credentialManager.connections') as ConnectionMeta[];
```

### Secrets
```typescript
// Through extension context (recommended)
const secret = await context.secrets.get(`credentialManager.secret.${connectionId}`);

// Through VS Code API (for other extensions)
const secretStorage = (vscode as any).extensions.getExtension('IuliusHutuleac.credential-manager')?.exports?.getSecret;
```

### Example Integration

Here's how another extension might use the Credential Manager:

```typescript
import * as vscode from 'vscode';

async function getConnectionsByType(type: ConnectionType) {
  const config = vscode.workspace.getConfiguration();
  const connections = config.get('credentialManager.connections') as ConnectionMeta[];

  const filteredConnections = [];
  for (const conn of connections) {
    if (conn.type === type) {
      // Get the secret from VS Code's secure storage
      const secret = await vscode.workspace.getConfiguration().get(`credentialManager.secret.${conn.id}`);

      // Build auth headers
      const headers = {};
      if (conn.authType === 'basic' && conn.username && secret) {
        headers['Authorization'] = 'Basic ' + Buffer.from(conn.username + ':' + secret).toString('base64');
      } else if (conn.authType === 'bearer' && secret) {
        headers['Authorization'] = `Bearer ${secret}`;
      }

      filteredConnections.push({
        id: conn.id,
        name: conn.name,
        url: conn.url,
        type: conn.type,
        headers: headers
      });
    }
  }

  return filteredConnections;
}

// Usage examples:
async function getKafkaConnectClusters() {
  return await getConnectionsByType('connect');
}

async function getSchemaRegistries() {
  return await getConnectionsByType('schema-registry');
}

async function getFlinkGateways() {
  return await getConnectionsByType('flink-gateway');
}
```

### Commands

The Credential Manager provides the following commands that other extensions can execute:

- `credentialManager.openConnectionManager`: Opens the connection manager panel (`Ctrl+Shift+C`)
- `credentialManager.addConnection`: Opens the connection manager in add mode
- `credentialManager.openEditConnection`: Opens the connection manager for editing connections
- `credentialManager.exportConnections`: Exports all connections to a JSON file
- `credentialManager.importConnections`: Imports connections from a JSON file

### UI Features

The Connection Manager UI provides the following features:

- **Add Connection**: Create new connections with various authentication types
- **Edit Connection**: Modify existing connection settings
- **Duplicate Connection**: Create a copy of an existing connection with "(Copy)" appended to the name
- **Test Connection**: Verify connection configuration and authentication
- **Remove Connection**: Delete connections (with confirmation)
- **Export/Import**: Backup and restore connection configurations
- **Refresh**: Reload the connection list

### Events

The extension doesn't currently emit events, but you can listen for configuration changes:

```typescript
vscode.workspace.onDidChangeConfiguration(event => {
  if (event.affectsConfiguration('credentialManager.connections')) {
    // Connections have been updated
    console.log('Credential Manager connections changed');
  }
});
```

## Development

To develop extensions that integrate with the Credential Manager:

1. Add the Credential Manager as a dependency or ensure it's installed
2. Use the configuration and secret storage APIs as shown above
3. Handle cases where the Credential Manager might not be installed
4. Test your integration thoroughly

## Troubleshooting & Data Recovery

### Finding Your Stored Data

**Connection Metadata:**
- Open VS Code Command Palette (`Ctrl+Shift+P`)
- Run: `Preferences: Open Workspace Settings (JSON)`
- Look for: `"credentialManager.connections"`

**Secrets (Windows):**
- Open Windows Credential Manager
- Look under "Windows Credentials"
- Search for: `vscodevscode.github-authentication`

**Secrets (macOS):**
- Open Keychain Access
- Search for: `vscodevscode.github-authentication`

**Secrets (Linux):**
- GNOME Keyring: `seahorse` application
- KWallet: `kwalletmanager` application

### Data Recovery

1. **Backup Connection Metadata**: Copy the `credentialManager.connections` array from workspace settings
2. **Export Functionality**: Use the built-in export feature to create a backup file
3. **Manual Recovery**: Recreate connections using the exported JSON file

### Common Issues

- **Secrets not accessible**: VS Code secret storage may be corrupted; try restarting VS Code
- **Settings not saving**: Check workspace permissions and VS Code settings sync
- **Migration issues**: Legacy base64 passwords are automatically migrated on first access

## Security

The Credential Manager uses industry-standard security practices:

- **Secure Password Storage**: Passwords are encrypted and stored using VS Code's built-in secret storage API
- **Workspace Settings**: Connection metadata (URLs, usernames, etc.) is stored in workspace settings
- **No Plain Text**: Passwords are never stored in plain text or weakly encoded formats
- **VS Code Security**: Leverages VS Code's native encryption and secure storage mechanisms
- **Platform Integration**: Uses the operating system's secure credential storage
