-- Test script for job management functionality

-- Create a long-running job for testing stop/cancel functionality
CREATE TABLE TestJobSource (
  id BIGINT,
  name STRING,
  value DOUBLE,
  created_time TIMESTAMP(3)
) WITH (
  'connector' = 'datagen',
  'number-of-rows' = '1000000',  -- Large number for long-running job
  'rows-per-second' = '10'       -- Slow generation for testing
);

-- Create a sink table
CREATE TABLE TestJobSink (
  id BIGINT,
  name STRING,
  value DOUBLE,
  created_time TIMESTAMP(3)
) WITH (
  'connector' = 'print'
);

-- Start a streaming job that we can stop/cancel
INSERT INTO TestJobSink SELECT * FROM TestJobSource;
