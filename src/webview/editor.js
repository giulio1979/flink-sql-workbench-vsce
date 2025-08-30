// Global variables
let editor;
let vscode;
let isExecuting = false;

// Initialize VS Code API
if (typeof acquireVsCodeApi !== 'undefined') {
    vscode = acquireVsCodeApi();
}

// Initialize Monaco Editor
function initializeEditor() {
    if (typeof monaco === 'undefined') {
        console.error('Monaco editor not loaded');
        return;
    }

    // Configure Monaco for SQL
    monaco.languages.register({ id: 'flinksql' });
    
    // Set language configuration
    monaco.languages.setLanguageConfiguration('flinksql', {
        comments: {
            lineComment: '--',
            blockComment: ['/*', '*/']
        },
        brackets: [
            ['{', '}'],
            ['[', ']'],
            ['(', ')']
        ],
        autoClosingPairs: [
            { open: '{', close: '}' },
            { open: '[', close: ']' },
            { open: '(', close: ')' },
            { open: '"', close: '"' },
            { open: "'", close: "'" }
        ],
        surroundingPairs: [
            { open: '{', close: '}' },
            { open: '[', close: ']' },
            { open: '(', close: ')' },
            { open: '"', close: '"' },
            { open: "'", close: "'" }
        ]
    });

    // Define Flink SQL tokens
    monaco.languages.setMonarchTokensProvider('flinksql', {
        defaultToken: '',
        tokenPostfix: '.sql',
        ignoreCase: true,

        keywords: [
            'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER',
            'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'DISTINCT', 'AS', 'UNION',
            'INSERT', 'INTO', 'VALUES', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'TABLE',
            'DATABASE', 'SCHEMA', 'INDEX', 'VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER',
            'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'BETWEEN', 'LIKE', 'EXISTS', 'CASE',
            'WHEN', 'THEN', 'ELSE', 'END', 'IF', 'WHILE', 'FOR', 'BEGIN', 'COMMIT', 'ROLLBACK',
            // Flink specific keywords
            'WATERMARK', 'SYSTEM_TIME', 'PROCTIME', 'ROWTIME', 'TEMPORARY', 'CATALOG',
            'CONNECTOR', 'FORMAT', 'OPTIONS', 'PARTITIONED', 'TBLPROPERTIES', 'SHOW', 'DESCRIBE',
            'EXPLAIN', 'USE', 'RESET', 'SET', 'HELP'
        ],

        operators: [
            '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=',
            '<>', '&&', '||', '++', '--', '+', '-', '*', '/', '&', '|', '^', '%', '<<',
            '>>', '>>>', '+=', '-=', '*=', '/=', '&=', '|=', '^=', '%=', '<<=', '>>=', '>>>='
        ],

        builtinFunctions: [
            'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'UPPER', 'LOWER', 'SUBSTRING', 'LENGTH',
            'TRIM', 'LTRIM', 'RTRIM', 'REPLACE', 'CONCAT', 'COALESCE', 'NULLIF', 'CAST',
            'EXTRACT', 'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND', 'NOW', 'CURRENT_TIMESTAMP',
            // Flink specific functions
            'TUMBLE', 'HOP', 'SESSION', 'TUMBLE_START', 'TUMBLE_END', 'HOP_START', 'HOP_END',
            'SESSION_START', 'SESSION_END', 'PROCTIME', 'ROWTIME', 'TO_TIMESTAMP'
        ],

        tokenizer: {
            root: [
                { include: '@comments' },
                { include: '@whitespace' },
                { include: '@numbers' },
                { include: '@strings' },
                { include: '@scopes' },
                [/[;,.]/, 'delimiter'],
                [/[()]/, '@brackets'],
                [/[\w@#$]+/, {
                    cases: {
                        '@keywords': 'keyword',
                        '@operators': 'operator',
                        '@builtinFunctions': 'predefined',
                        '@default': 'identifier'
                    }
                }]
            ],

            comments: [
                [/--+.*/, 'comment'],
                [/\/\*/, { token: 'comment.quote', next: '@comment' }]
            ],

            comment: [
                [/[^*/]+/, 'comment'],
                [/\*\//, { token: 'comment.quote', next: '@pop' }],
                [/./, 'comment']
            ],

            whitespace: [
                [/\s+/, 'white']
            ],

            numbers: [
                [/0[xX][0-9a-fA-F]*/, 'number'],
                [/[$][+-]*\d*(\.\d*)?/, 'number'],
                [/((\d+(\.\d*)?)|(\.\d+))([eE][\-+]?\d+)?/, 'number']
            ],

            strings: [
                [/'/, { token: 'string', next: '@string' }],
                [/"/, { token: 'string.double', next: '@stringDouble' }]
            ],

            string: [
                [/[^']+/, 'string'],
                [/''/, 'string'],
                [/'/, { token: 'string', next: '@pop' }]
            ],

            stringDouble: [
                [/[^"]+/, 'string.double'],
                [/""/, 'string.double'],
                [/"/, { token: 'string.double', next: '@pop' }]
            ],

            scopes: [
                [/[a-zA-Z_][\w]*\.(?=\w)/, 'identifier.scope']
            ]
        }
    });

    // Create the editor
    editor = monaco.editor.create(document.getElementById('editor-container'), {
        value: '',
        language: 'flinksql',
        theme: 'vs-dark',
        automaticLayout: true,
        fontSize: 14,
        lineNumbers: 'on',
        roundedSelection: false,
        scrollBeyondLastLine: false,
        minimap: { enabled: true },
        wordWrap: 'on',
        contextmenu: true,
        selectOnLineNumbers: true,
        glyphMargin: true,
        folding: true,
        foldingStrategy: 'indentation',
        renderLineHighlight: 'line',
        occurrencesHighlight: true,
        selectionHighlight: true,
        codeLens: false,
        scrollbar: {
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10
        }
    });

    // Listen for content changes
    editor.onDidChangeModelContent(() => {
        if (vscode) {
            vscode.postMessage({
                type: 'updateDocument',
                text: editor.getValue()
            });
        }
    });

    // Add key bindings
    editor.addAction({
        id: 'execute-query',
        label: 'Execute Query',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
        run: function() {
            executeQuery();
        }
    });

    editor.addAction({
        id: 'format-sql',
        label: 'Format SQL',
        keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF],
        run: function() {
            formatSql();
        }
    });

    // Setup event handlers
    setupEventHandlers();
}

function setupEventHandlers() {
    // Execute button
    const executeBtn = document.getElementById('executeBtn');
    if (executeBtn) {
        executeBtn.addEventListener('click', executeQuery);
    }

    // Format button
    const formatBtn = document.getElementById('formatBtn');
    if (formatBtn) {
        formatBtn.addEventListener('click', formatSql);
    }

    // Handle messages from the extension
    if (vscode) {
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'update':
                    if (editor && editor.getValue() !== message.text) {
                        editor.setValue(message.text);
                    }
                    break;
                case 'executionProgress':
                    updateExecutionProgress(message);
                    break;
                case 'queryExecuted':
                    setExecutionStatus(message.success, message.error);
                    break;
            }
        });
    }
}

function executeQuery() {
    if (!editor || isExecuting) {
        return;
    }

    const selection = editor.getSelection();
    let query;

    if (selection && !selection.isEmpty()) {
        query = editor.getModel().getValueInRange(selection);
    } else {
        query = editor.getValue();
    }

    if (!query.trim()) {
        updateStatus('No query to execute', 'error');
        return;
    }

    setExecuting(true);
    updateStatus('Executing query...', 'executing');

    if (vscode) {
        vscode.postMessage({
            type: 'executeQuery',
            query: query.trim()
        });
    }
}

function formatSql() {
    if (!editor) {
        return;
    }

    const sql = editor.getValue();
    let formatted = sql;

    try {
        // Prefer a bundled sql-formatter if available. The bundler (webpack) will
        // provide `require` at bundle time so this works when the extension is built.
        const sqlFormatterModule = (typeof sqlFormatter !== 'undefined') ? sqlFormatter :
            (typeof require !== 'undefined' ? require('sql-formatter') : null);

        if (sqlFormatterModule && typeof sqlFormatterModule.format === 'function') {
            // sql-formatter exports a `format` function
            formatted = sqlFormatterModule.format(sql, { language: 'sql', uppercase: true });
        } else if (sqlFormatterModule && typeof sqlFormatterModule === 'function') {
            // defensive: in some module shapes the export may be the function itself
            formatted = sqlFormatterModule(sql);
        } else {
            // Fallback to lightweight ad-hoc formatting if the formatter isn't available
            formatted = sql
                .replace(/\s+/g, ' ')
                .replace(/,\s*/g, ',\n  ')
                .replace(/\b(SELECT|FROM|WHERE|JOIN|GROUP BY|ORDER BY|HAVING|UNION|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/gi, '\n$1')
                .replace(/\n\s*\n/g, '\n')
                .trim();
        }
    } catch (err) {
        // If anything goes wrong, log and fallback to ad-hoc formatter
        console.warn('SQL formatter failed, using fallback formatting', err);
        formatted = sql
            .replace(/\s+/g, ' ')
            .replace(/,\s*/g, ',\n  ')
            .replace(/\b(SELECT|FROM|WHERE|JOIN|GROUP BY|ORDER BY|HAVING|UNION|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/gi, '\n$1')
            .replace(/\n\s*\n/g, '\n')
            .trim();
    }

    editor.setValue(formatted);
}

function setExecuting(executing) {
    isExecuting = executing;
    const executeBtn = document.getElementById('executeBtn');
    if (executeBtn) {
        executeBtn.disabled = executing;
        executeBtn.textContent = executing ? '⏸ Executing...' : '▶ Execute Query';
    }
}

function setExecutionStatus(success, error) {
    setExecuting(false);
    if (success) {
        updateStatus('Query executed successfully', 'success');
        setTimeout(() => updateStatus('Ready', ''), 3000);
    } else {
        updateStatus(`Query failed: ${error || 'Unknown error'}`, 'error');
    }
}

function updateExecutionProgress(message) {
    // Update status with live progress information
    const { state, rowCount, columnCount, resultType, resultKind } = message;
    
    if (state === 'RUNNING') {
        let statusText = `Executing... `;
        if (rowCount > 0) {
            statusText += `${rowCount} rows`;
            if (columnCount > 0) {
                statusText += `, ${columnCount} columns`;
            }
        }
        if (resultType && resultType !== 'EOS') {
            statusText += ` (${resultType})`;
        }
        updateStatus(statusText, 'executing');
    } else if (state === 'STOPPED') {
        updateStatus(`Completed: ${rowCount} rows, ${columnCount} columns`, 'success');
    }
}

function updateStatus(message, type = '') {
    const statusElement = document.getElementById('status');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.className = `status ${type}`;
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        // Editor will be initialized when Monaco loads
    });
} else {
    // DOM is already ready
    if (typeof monaco !== 'undefined') {
        initializeEditor();
    }
}
