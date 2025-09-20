-- Sample Flink SQL queries for testing the extension

-- Create a table
CREATE TABLE source_table (
    id BIGINT,
    name STRING,
    created_at TIMESTAMP(3),
    WATERMARK FOR created_at AS created_at - INTERVAL '5' SECOND
) WITH (
    'connector' = 'kafka',
    'topic' = 'source-topic',
    'properties.bootstrap.servers' = 'localhost:9092',
    'properties.group.id' = 'test-group',
    'format' = 'json'
);

-- Simple SELECT query
SELECT * FROM source_table LIMIT 10;

-- Aggregation query
SELECT 
    name,
    COUNT(*) as count,
    TUMBLE_START(created_at, INTERVAL '1' MINUTE) as window_start
FROM source_table
GROUP BY name, TUMBLE(created_at, INTERVAL '1' MINUTE);