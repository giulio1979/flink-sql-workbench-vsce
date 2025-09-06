import * as assert from 'assert';
import { SecretProcessor, SecretProcessingError } from '../services/SecretProcessor';

suite('SecretProcessor Tests', () => {
    const originalEnv = process.env;

    teardown(() => {
        // Restore original environment
        process.env = originalEnv;
    });

    test('should extract secret references correctly', () => {
        const sql = `
            SELECT * FROM my_table 
            WHERE password = '\${secrets://my-namespace:db-secret/password}'
            AND api_key = '\${secrets://api-namespace:api-secret/api-key}'
        `;

        const references = SecretProcessor.extractSecretReferences(sql);
        
        assert.strictEqual(references.length, 2);
        assert.strictEqual(references[0].namespace, 'my-namespace');
        assert.strictEqual(references[0].secretName, 'db-secret');
        assert.strictEqual(references[0].key, 'password');
        assert.strictEqual(references[1].namespace, 'api-namespace');
        assert.strictEqual(references[1].secretName, 'api-secret');
        assert.strictEqual(references[1].key, 'api-key');
    });

    test('should process secret references with environment variables', () => {
        // Setup environment variables
        process.env.password = 'secret123';
        process.env['api-key'] = 'key456';

        const sql = `
            SELECT * FROM my_table 
            WHERE password = '\${secrets://my-namespace:db-secret/password}'
            AND api_key = '\${secrets://api-namespace:api-secret/api-key}'
        `;

        const processedSql = SecretProcessor.processStatement(sql);
        
        assert.ok(processedSql.includes("password = 'secret123'"));
        assert.ok(processedSql.includes("api_key = 'key456'"));
        assert.ok(!processedSql.includes('${secrets://'));
    });

    test('should throw error for missing environment variable', () => {
        // Make sure the environment variable doesn't exist
        delete process.env.missing_key;

        const sql = "SELECT * FROM table WHERE key = '\${secrets://ns:secret/missing_key}'";

        assert.throws(() => {
            SecretProcessor.processStatement(sql);
        }, SecretProcessingError);
    });

    test('should validate statement correctly', () => {
        // Setup some environment variables
        process.env.existing_key = 'value';
        delete process.env.missing_key;

        const sql = `
            SELECT * FROM table 
            WHERE key1 = '\${secrets://ns:secret/existing_key}'
            AND key2 = '\${secrets://ns:secret/missing_key}'
        `;

        const validation = SecretProcessor.validateStatement(sql);
        
        assert.strictEqual(validation.isValid, false);
        assert.strictEqual(validation.missingEnvVars.length, 1);
        assert.strictEqual(validation.missingEnvVars[0], 'missing_key');
        assert.strictEqual(validation.secretReferences.length, 2);
    });

    test('should handle statements without secret references', () => {
        const sql = "SELECT * FROM table WHERE id = 1";
        
        const references = SecretProcessor.extractSecretReferences(sql);
        const processedSql = SecretProcessor.processStatement(sql);
        const validation = SecretProcessor.validateStatement(sql);
        
        assert.strictEqual(references.length, 0);
        assert.strictEqual(processedSql, sql);
        assert.strictEqual(validation.isValid, true);
        assert.strictEqual(validation.missingEnvVars.length, 0);
    });

    test('should handle empty or null statements', () => {
        assert.strictEqual(SecretProcessor.processStatement(''), '');
        assert.strictEqual(SecretProcessor.processStatement('   '), '   ');
        assert.strictEqual(SecretProcessor.extractSecretReferences('').length, 0);
        
        const validation = SecretProcessor.validateStatement('');
        assert.strictEqual(validation.isValid, true);
    });

    test('should handle complex secret reference patterns', () => {
        process.env['complex-key-123'] = 'complex_value';
        process.env.simple = 'simple_value';

        const sql = `
            CREATE TABLE test_table (
                id INT,
                password VARCHAR(255) DEFAULT '\${secrets://prod-namespace:database-credentials/complex-key-123}',
                token VARCHAR(500) DEFAULT '\${secrets://dev:api-tokens/simple}'
            )
        `;

        const processedSql = SecretProcessor.processStatement(sql);
        
        assert.ok(processedSql.includes("DEFAULT 'complex_value'"));
        assert.ok(processedSql.includes("DEFAULT 'simple_value'"));
        assert.ok(!processedSql.includes('${secrets://'));
    });
});
