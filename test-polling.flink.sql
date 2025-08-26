-- Test file for improved Flink SQL results with polling

-- 1. Create table with faster data generation
CREATE TABLE FastTestTable (
  id BIGINT,
  name STRING,
  value DOUBLE,
  created_time TIMESTAMP(3)
) WITH (
  'connector' = 'datagen',
  'number-of-rows' = '20',
  'rows-per-second' = '5'
);

-- 2. Wait a moment, then query (the polling should now wait for data)
SELECT * FROM FastTestTable LIMIT 5;

-- 3. Test with a simple catalog query (should work immediately)
SHOW CATALOGS;
