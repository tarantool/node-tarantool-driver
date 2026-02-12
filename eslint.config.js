const { rules } = require('@eslint/js').configs.recommended;

module.exports = [
    // Configuration for JavaScript files
    {
        files: ['lib/*'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'commonjs',
            globals: {
                // Node.js globals
                global: 'readonly',
                process: 'readonly',
                Buffer: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                console: 'readonly',
                setImmediate: 'readonly',
                clearImmediate: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
            },
        },
        rules: {
            ...rules, // use recommended defaults
            // Error prevention rules
            'block-scoped-var': 'error',
            'no-cond-assign': 'error',
            'no-control-regex': 'error',
            'no-debugger': 'error',
            'no-dupe-args': 'error',
            'no-dupe-keys': 'error',
            'no-duplicate-case': 'error',
            'no-ex-assign': 'error',
            'no-extra-semi': 'error',
            'no-func-assign': 'error',
            'no-invalid-regexp': 'error',
            'no-irregular-whitespace': 'error',
            'no-obj-calls': 'error',
            'no-redeclare': 'error',
            'no-regex-spaces': 'error',
            'no-sparse-arrays': 'error',
            'no-unexpected-multiline': 'error',
            'no-unreachable': 'error',
            'no-delete-var': 'error',
            'no-shadow': [
                'error',
                { builtinGlobals: false, hoist: 'all', allow: [] },
            ],
            'no-undef': 'error',
            'use-isnan': 'error',
            'valid-typeof': 'error',

            // Code quality and best practices
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-with': 'error',
            'no-multi-spaces': 'error',
            'no-multiple-empty-lines': [
                'error',
                { max: 2, maxBOF: 0, maxEOF: 0 },
            ],
            'no-trailing-spaces': 'error',
            'eol-last': ['error', 'always'],
            semi: ['error', 'always'],
            indent: ['error', 4, { SwitchCase: 1 }],
            quotes: ['error', 'single', { avoidEscape: true }],
            'comma-dangle': ['error', 'never'],
            'no-console': [
                'warn',
                { allow: ['warn', 'error', 'table', 'info'] },
            ],

            // Security-related rules
            'no-new-func': 'error',
            'no-script-url': 'error',

            // Performance considerations
            'no-constant-condition': 'warn',
            'no-unused-expressions': 'error',
            'no-useless-escape': 'warn',
            'no-useless-catch': 'error',
            'no-useless-return': 'error',

            // Readability improvements
            curly: ['error', 'all'],
            'brace-style': ['error', '1tbs', { allowSingleLine: true }],
            'keyword-spacing': 'error',
            'space-before-blocks': 'error',
            'space-before-function-paren': [
                'error',
                { anonymous: 'always', named: 'never', asyncArrow: 'always' },
            ],
            'space-infix-ops': 'error',
            'space-unary-ops': 'error',
            'prefer-const': 'warn',
            'no-var': 'error',
        },
    },
    // Configuration for test files
    {
        files: ['**/test/**/*.js', '**/*.js', '**/*.spec.js'],
        rules: {
            'no-console': 'off',
            'no-unused-expressions': 'off',
        },
    },
    // Ignore certain patterns
    {
        ignores: ['node_modules/**', 'coverage/**', '.git/**', '*.log'],
    },
];
