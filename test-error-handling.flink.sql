-- Test query that will likely cause an error (invalid syntax)
SELECT * FROM non_existent_table WHERE invalid_column = 'test';

-- Test query with syntax error  
SELCT name, age FROM users;

-- Test with connection issue (when gateway is not running)
SHOW TABLES;
