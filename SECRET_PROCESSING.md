# Secret Reference Processing

The Flink SQL Workbench extension now supports secret references in SQL statements for local development. This feature allows you to keep sensitive information like passwords, API keys, and connection strings as environment variables while maintaining clean SQL scripts that work in both local development and production environments.

## Format

Secret references use the following format:
```
${secrets://namespace:secretname/key}
```

Where:
- `namespace`: Kubernetes namespace (used for production, ignored in local development)
- `secretname`: Secret name (used for production, ignored in local development)  
- `key`: The key to look up in the secret (used as environment variable name in local development)

## How it Works

### Production (Kubernetes)
In production, your deployment system processes these references and replaces them with actual secret values from Kubernetes secrets.

### Local Development  
When developing locally with this VS Code extension:
1. The extension detects secret references in your SQL statements
2. Extracts the `key` part from each reference
3. Looks up the corresponding environment variable
4. Replaces the reference with the environment variable value
5. Executes the processed SQL statement

## Example

### SQL Script with Secret References
```sql
-- Create a connection to an external database
CREATE TABLE source_table (
    id INT,
    name STRING,
    email STRING
) WITH (
    'connector' = 'jdbc',
    'url' = 'jdbc:postgresql://localhost:5432/mydb',
    'table-name' = 'users',
    'username' = '${secrets://default:db-credentials/username}',
    'password' = '${secrets://default:db-credentials/password}'
);

-- Use API key for external service
CREATE TABLE api_sink (
    user_id INT,
    processed_data STRING
) WITH (
    'connector' = 'http',
    'url' = 'https://api.example.com/data',
    'headers.authorization' = 'Bearer ${secrets://api-namespace:api-tokens/bearer-token}'
);
```

### Environment Variables (for Local Development)
Set these environment variables in your development environment:
```bash
# For Windows PowerShell
$env:username = "dev_user"
$env:password = "dev_password_123"
$env:bearer-token = "dev_api_token_xyz"

# For Linux/Mac
export username="dev_user"
export password="dev_password_123"
export bearer-token="dev_api_token_xyz"
```

### Processed SQL (what gets executed)
```sql
CREATE TABLE source_table (
    id INT,
    name STRING,
    email STRING
) WITH (
    'connector' = 'jdbc',
    'url' = 'jdbc:postgresql://localhost:5432/mydb',
    'table-name' = 'users',
    'username' = 'dev_user',
    'password' = 'dev_password_123'
);

CREATE TABLE api_sink (
    user_id INT,
    processed_data STRING
) WITH (
    'connector' = 'http',
    'url' = 'https://api.example.com/data',
    'headers.authorization' = 'Bearer dev_api_token_xyz'
);
```

## Configuration

The extension provides configuration options to control secret processing:

### flinkSqlWorkbench.secrets.enableSecretProcessing
- **Type**: boolean
- **Default**: true
- **Description**: Enable processing of secret references in SQL statements for local development

### flinkSqlWorkbench.secrets.validateBeforeExecution  
- **Type**: boolean
- **Default**: true
- **Description**: Validate that all environment variables are available before executing SQL with secret references

## Error Handling

If secret processing is enabled and validation is enabled (both are default), the extension will:

1. **Validate before execution**: Check that all required environment variables exist
2. **Fail fast**: Stop execution and show clear error messages if any environment variables are missing
3. **Log processing**: Show in the output channel when secret references are being processed

### Example Error Message
```
Missing environment variables for secret references: api-key, database-password
```

## Security Considerations

1. **Environment Variables**: Environment variables are visible to the process and may appear in logs. Use this feature only in development environments.

2. **Logging**: The extension logs when secret processing occurs but masks the actual values in logs (showing only the first 4 characters followed by asterisks).

3. **Production**: This feature is intended for local development. In production, use your Kubernetes deployment pipeline's secret processing.

## Best Practices

1. **Use descriptive keys**: Choose environment variable names that clearly identify what they're for
   ```sql
   -- Good
   'password' = '${secrets://prod:db/database_password}'
   
   -- Less clear  
   'password' = '${secrets://prod:db/pwd}'
   ```

2. **Keep scripts identical**: Use the same secret reference format in both development and production scripts

3. **Document required variables**: Create a `.env.example` file or documentation listing all required environment variables for your project

4. **Use VS Code settings**: Configure the extension settings per workspace if needed

5. **Test validation**: Enable validation to catch missing environment variables early in development
