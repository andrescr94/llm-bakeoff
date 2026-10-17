import { describe, expect, it } from 'vitest';
import { loadConfig, validateConfig } from '../src/config.ts';
import type { BakeoffConfig } from '../src/types.ts';

const valid = (): BakeoffConfig => ({
	name: 'c',
	task: {
		id: 't',
		description: '',
		variants: [{ id: 'v1', system: 's' }],
		cases: [{ id: 'a', user: 'u' }],
		scorers: [{ name: 's', required: true, score: () => ({ pass: true }) }]
	},
	models: [{ id: 'vendor/model' }],
	rounds: 2,
	maxOutputTokens: 100,
	concurrency: 2,
	timeoutMs: 10_000,
	retries: 1,
	budgetUsd: 0.4
});

describe('validateConfig', () => {
	it('accepts a valid config', () => {
		expect(validateConfig(valid()).name).toBe('c');
	});
	it('rejects a model id without a vendor', () => {
		expect(() => validateConfig({ ...valid(), models: [{ id: 'gpt' }] })).toThrow(/models\.0\.id/);
	});
	it('rejects a duplicate model', () => {
		expect(() => validateConfig({ ...valid(), models: [{ id: 'v/m' }, { id: 'v/m' }] })).toThrow(/model "v\/m" appears twice/);
	});
	it('rejects a task with no required scorer, since nothing would define valid', () => {
		const c = valid();
		c.task.scorers = [{ name: 'fyi', required: false, score: () => ({ pass: true }) }];
		expect(() => validateConfig(c)).toThrow(/at least one scorer must be required/);
	});
	it('rejects a non-positive budget', () => {
		expect(() => validateConfig({ ...valid(), budgetUsd: 0 })).toThrow(/budgetUsd/);
	});
});

describe('loadConfig', () => {
	it('loads the example config', async () => {
		const config = await loadConfig('examples/intake-form/bakeoff.config.ts');
		expect(config.models).toHaveLength(4);
		expect(config.task.variants.map((v) => v.id)).toEqual(['v1-baseline', 'v2-options-rule']);
	});
});
