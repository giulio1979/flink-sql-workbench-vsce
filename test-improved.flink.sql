-- Test queries for Flink SQL Workbench

-- 1. First, show available catalogs
SHOW CATALOGS;

-- 2. Show current catalog and database
SHOW CURRENT CATALOG;
SHOW CURRENT DATABASE;

-- 3. Create a simple table with immediate data
CREATE TABLE TestTable (
  id BIGINT,
  name STRING,
  age INT,
  created_time TIMESTAMP(3)
) WITH (
  'connector' = 'datagen',
  'number-of-rows' = '5',
  'rows-per-second' = '1'
);

-- 4. Wait a moment, then query the table
-- (You may need to wait a few seconds for data generation)
SELECT * FROM TestTable;

-- 5. Show all tables to verify creation
SHOW TABLES;

-- 6. For streaming queries, try with LIMIT
SELECT * FROM TestTable LIMIT 10;

-- 7. Drop the table when done
-- DROP TABLE TestTable;
