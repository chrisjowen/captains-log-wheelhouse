import { existsSync, readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { DEFAULTS, readSettings } from '../wheelhouse/ui/digest.js';

const manifest = JSON.parse(readFileSync('.wheelhouse-plugin/plugin.json', 'utf8'));
// A copy of the plugin SDK's manifest schema, from
// https://raw.githubusercontent.com/chrisjowen/wheelhouse/main/packages/plugin-sdk/plugin.schema.json
const schema = JSON.parse(readFileSync('test/fixtures/plugin.schema.json', 'utf8'));

describe('the manifest', () => {
	it("matches the plugin SDK's schema", () => {
		const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
		expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
	});

	it('is off until the captain turns it on', () => {
		expect(manifest.wheelhouse.enabledByDefault).toBe(false);
	});

	it('names entries that exist', () => {
		expect(existsSync(manifest.wheelhouse.server)).toBe(true);
		expect(existsSync(manifest.wheelhouse.ui)).toBe(true);
	});

	it('declares the settings the plugin reads, with defaults it accepts', () => {
		const settings = manifest.wheelhouse.settings;
		expect(Object.keys(settings).sort()).toEqual(Object.keys(DEFAULTS).sort());
		const defaults = Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, v.default]));
		expect(readSettings(defaults)).toEqual({ ...DEFAULTS, problems: [] });
	});

	it('agrees with package.json on its version', () => {
		const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
		expect(manifest.version).toBe(pkg.version);
	});
});
