-- Simple test queries to debug results display
SELECT 1 as test_column;

SELECT 'hello' as greeting, 42 as number;

-- Basic SELECT without FROM (should work on most SQL systems)
SELECT 
    'test_row_1' as name,
    100 as value,
    CURRENT_TIMESTAMP as created_at;