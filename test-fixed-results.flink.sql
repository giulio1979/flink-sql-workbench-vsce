-- Test queries for improved result fetching

-- 1. Test simple catalog query (should work immediately)
SHOW CATALOGS;

-- 2. Create a finite table that will produce results quickly
CREATE TABLE TestResults (
  id BIGINT,
  name STRING,
  value DOUBLE
) WITH (
  'connector' = 'datagen',
  'number-of-rows' = '5'
);

-- 3. Query the finite table (should get results when job finishes)
SELECT * FROM TestResults;

-- 4. Simple table listing
SHOW TABLES;
