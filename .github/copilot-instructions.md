# Flink SQL Workbench Extension - Development Guidelines

## Architecture Overview

**Dependencies:** Requires `IuliusHutuleac.credential-manager` extension for secure credential storage.

**Core Components:**
- `GlobalState` - Active sessions and connection details
- `CredentialManagerService` - Interface with credential manager extension  
- `FlinkSqlEditorProvider` - SQL editor webview management
- `StatementExecutionEngine` - SQL execution and result retrieval
- `FlinkApiService` - Flink SQL Gateway REST API client
- `StatementManager` - SQL statement execution orchestration
- `SecretProcessor` - Secret reference processing for local development

**Views:**
- **Connections Manager** - Gateway connection selection and credential management
- **Session Manager** - Session creation/deletion/selection
- **Jobs Manager** - Cluster job monitoring and management
- **Catalog Explorer** - Flink catalog browsing (databases, tables, views)
- **Results View** - Query results display with automatic updates. Once a query is executed, the results are shown in a new tab in the results view. All queries are executed in same fashion, the results are updated automatically, we submit the query and poll for updates until query is completed or user cancels results polling. A button on Results window allows us to cancel results polling. If a query is executing and the results window is already in use we cancel polling of current query and use the results window for next query.
- **SQL Editor** - A webview-based SQL editor with syntax highlighting, autocompletion, multiple statements execution, and results display integration. The editor is registered for `.flinksql.sql` files. The editor has a toolbar with buttons to select connection, select session, execute current statement, execute all statements, and stop current running query. The editor also has autocompletion support for SQL keywords and catalog objects (catalogs, databases, tables, views, columns). The autocompletion for catalog objects is based on current selected session.

**Development Constraint:** We should not build any extra functionality that is not strictly mentioned in these instructions.

---

## 🚨 CRITICAL: Flink Gateway API Usage (DO NOT CHANGE)

### ✅ CORRECT Flow (Implemented)
```
1. POST /v1/sessions/{sessionHandle}/statements → get operationHandle
2. GET /v1/sessions/{sessionHandle}/operations/{operationHandle}/result/{token}
3. Continue polling with incremented tokens until resultType === 'EOS'
4. Stop immediately when EOS received
```

### ❌ FORBIDDEN Patterns
- **NEVER** use `/operations/{handle}/status` endpoint
- **NEVER** add status polling before result polling
- **NEVER** continue polling after EOS signal

### 🔧 Implementation Requirements

**FlinkApiService.ts:**
```typescript
// Use correct Flink SQL Gateway API path format
const endpoint = '/v1/sessions';
return await this.makeRequest(endpoint, ...);
```

**StatementExecutionEngine.ts:**
```typescript
// MUST use direct polling pattern
async executeSQL(statement: string): Promise<ExecutionResult> {
    const operationResponse = await this.flinkApi.submitStatement(sessionHandle, statement);
    this.operationHandle = operationResponse.operationHandle;
    return await this.pollForResults(sessionHandle); // NO status checking
}

private async pollForResults(sessionHandle: string): Promise<ExecutionResult> {
    let nextToken = 0;
    let shouldContinue = true;
    
    while (shouldContinue && !this.cancelled) {
        const response = await this.flinkApi.getOperationResults(sessionHandle, this.operationHandle!, nextToken);
        
        // Process results...
        
        if (response.resultType === 'EOS') {
            shouldContinue = false; // CRITICAL: Stop immediately
        } else if (response.nextResultUri) {
            nextToken = parseInt(tokenMatch[1]);
        } else {
            shouldContinue = false;
        }
        
        // CRITICAL: Only sleep if continuing
        if (shouldContinue && !this.cancelled) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}
```

---

## 🛡️ Development Guardrails

### ❌ NEVER
1. Add operation status polling
2. Use incorrect API paths (avoid `/api/v1/` - use `/v1/` instead)
3. Add delays after EOS signal
4. Remove debug logging
5. Change core polling structure

### ✅ ALWAYS
1. Test with real Flink Gateway before changes
2. Verify polling stops on EOS without extra calls
3. Maintain submit→poll flow (no intermediate status)
4. Use correct API paths (`/v1/` format)
5. Compile and test before committing

### 📋 Pre-Commit Testing Checklist
- [ ] `SHOW DATABASES` works and stops cleanly on EOS
- [ ] API endpoints use correct `/v1/` format
- [ ] No extra polling calls after EOS signal
- [ ] Extension compiles without errors
- [ ] Debug logs show correct API flow

---

## Secret Processing

**Format:** `${secrets://namespace:secretname/key}`
- `namespace`: K8s namespace (ignored locally)
- `secretname`: Secret name (ignored locally)  
- `key`: Environment variable name for local development

**Local Development:** Extension extracts `key` and looks up environment variable.

**Settings:**
- `flinkSqlWorkbench.secrets.enableSecretProcessing` (default: true)
- `flinkSqlWorkbench.secrets.validateBeforeExecution` (default: true)

---

## API Reference Summary

**Key Endpoints:**
- `POST /v1/sessions` - Create session
- `POST /v1/sessions/{sessionHandle}/statements` - Submit statement
- `GET /v1/sessions/{sessionHandle}/operations/{operationHandle}/result/{token}` - Poll results

**Critical Response Fields:**
- `resultType: 'EOS'` - End of stream, stop polling immediately
- `nextResultUri` - Contains next token for continued polling
- `resultKind: 'SUCCESS_WITH_CONTENT'` - Process data rows

---

## Flink Gateway REST API Key Endpoints

### Session Management
- `POST /v1/sessions` - Create new session
- `GET /v1/sessions/{sessionHandle}` - Get session configuration
- `DELETE /v1/sessions/{sessionHandle}` - Close session

### Statement Execution
- `POST /v1/sessions/{sessionHandle}/statements` - Submit SQL statement
- `GET /v1/sessions/{sessionHandle}/operations/{operationHandle}/result/{token}` - Get results
- `GET /v1/sessions/{sessionHandle}/complete-statement` - Get completion hints

### Important: Use `/v1/` paths as per the official Flink SQL Gateway REST API specification

---

## Secret Processing

**Format:** `${secrets://namespace:secretname/key}`

**Components:**
- `namespace`: Kubernetes namespace (ignored in local development)
- `secretname`: Secret name (ignored in local development)  
- `key`: Environment variable name for local development

**Local Development Behavior:**
1. Extension detects secret references in SQL statements
2. Extracts the `key` part from each reference
3. Looks up corresponding environment variable
4. Replaces reference with environment variable value
5. Executes processed SQL statement

**Example:**
```sql
CREATE TABLE source_table (
    id INT,
    name STRING
) WITH (
    'connector' = 'jdbc',
    'url' = 'jdbc:postgresql://localhost:5432/mydb',
    'username' = '${secrets://default:db-credentials/username}',
    'password' = '${secrets://default:db-credentials/password}'
);
```

**Settings:**
- `flinkSqlWorkbench.secrets.enableSecretProcessing` (default: true)
- `flinkSqlWorkbench.secrets.validateBeforeExecution` (default: true)

**Environment Variables Required:**
- `username` (for the username key in example above)
- `password` (for the password key in example above)

**Remember:** This implementation matches a proven working web application. Do not "improve" the core flow - it's already optimal.