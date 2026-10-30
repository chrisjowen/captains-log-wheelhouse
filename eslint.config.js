import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
	{ ignores: ['node_modules/', '.serena/'] },
	js.configs.recommended,
	prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] }
	}
];
