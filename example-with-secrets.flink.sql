-- Example Flink SQL script demonstrating secret reference processing
-- This script shows how to use secret references for sensitive data
-- that will be replaced with environment variables during local development

-- Set some environment variables before running this example:
-- $env:db_username = "dev_user"           (Windows PowerShell)
-- $env:db_password = "dev_password"       (Windows PowerShell)  
-- $env:api_token = "your_api_token_here"  (Windows PowerShell)
--
-- export db_username="dev_user"          (Linux/Mac)
-- export db_password="dev_password"      (Linux/Mac)
-- export api_token="your_api_token_here" (Linux/Mac)

-- Create a table that connects to an external database using secret references
CREATE TABLE user_source (
    user_id INT,
    username STRING,
    email STRING,
    created_at TIMESTAMP(3)
) WITH (
    'connector' = 'jdbc',
    'url' = 'jdbc:postgresql://localhost:5432/demo_db',
    'table-name' = 'users',
    'username' = '${secrets://database-namespace:db-credentials/db_username}',
    'password' = '${secrets://database-namespace:db-credentials/db_password}',
    'driver' = 'org.postgresql.Driver'
);

-- Create a table for sending data to an external API using secret references  
CREATE TABLE api_sink (
    user_id INT,
    username STRING,
    processed_timestamp TIMESTAMP(3)
) WITH (
    'connector' = 'http',
    'url' = 'https://api.example.com/users',
    'method' = 'POST',
    'headers.authorization' = 'Bearer ${secrets://api-namespace:api-tokens/api_token}',
    'headers.content-type' = 'application/json',
    'format' = 'json'
);

-- A simple data processing query
INSERT INTO api_sink
SELECT 
    user_id,
    username,
    CURRENT_TIMESTAMP as processed_timestamp
FROM user_source
WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '1' DAY;

-- You can also use secret references in other contexts
-- For example, in a filter condition (though this is less common)
SELECT * FROM user_source 
WHERE username != '${secrets://test-namespace:test-data/admin_username}';

-- Or in computed values
SELECT 
    user_id,
    username,
    CONCAT('Key: ', '${secrets://encryption-namespace:keys/encryption_key}') as secured_field
FROM user_source
LIMIT 5;
