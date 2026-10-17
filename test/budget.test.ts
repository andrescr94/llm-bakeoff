import { describe, expect, it } from 'vitest';
import { assertWithinBudget, BudgetExceededError, countCalls, estimateMaxCost, estimateTokens } from '../src/budget.ts';
import type { BakeoffConfig } from '../src/types.ts';

const config = (over: Partial<BakeoffConfig> = {}): BakeoffConfig => ({
	name: 'b',
	task: {
		id: 't',
		description: '',
		variants: [{ id: 'v1', system: 'x'.repeat(300) }],
		cases: [
			{ id: 'a', user: 'x'.repeat(30) },
			{ id: 'b', user: 'x'.repeat(30) }
		],
		scorers: [{ name: 's', required: true, score: () => ({ pass: true }) }]
	},
	models: [{ id: 'v/m' }],
	rounds: 2,
	maxOutputTokens: 1000,
	concurrency: 2,
	timeoutMs: 10_000,
	retries: 1,
	budgetUsd: 1,
	...over
});

const prices = { 'v/m': { prompt: 1e-6, completion: 2e-6 } };

describe('budget guard', () => {
	it('estimates tokens pessimistically at three characters each', () => {
		expect(estimateTokens('x'.repeat(10))).toBe(4);
	});

	it('counts the whole matrix', () => {
		expect(countCalls(config({ models: [{ id: 'v/m' }, { id: 'v/n' }] }))).toBe(8);
	});

	it('assumes full output, every retry and no cache discount', () => {
		// per round: 2 cases × (100 + 10) input tokens = 220; 2 rounds = 440 tokens × 1e-6
		// output: 4 calls × 1000 × 2e-6 = 0.008; × 2 attempts
		const estimate = estimateMaxCost(config(), prices);
		expect(estimate.calls).toBe(4);
		expect(estimate.maxUsd).toBeCloseTo((440e-6 + 0.008) * 2, 10);
	});

	it('refuses to start above the cap', () => {
		expect(() => assertWithinBudget(config({ budgetUsd: 0.01 }), prices)).toThrow(BudgetExceededError);
		expect(assertWithinBudget(config({ budgetUsd: 0.02 }), prices).maxUsd).toBeLessThan(0.02);
	});

	it('refuses a model it cannot price, rather than guessing', () => {
		expect(() => assertWithinBudget(config(), {})).toThrow(/No price for v\/m/);
	});

	it('uses config pricing over fetched prices', () => {
		const cheap = config({ pricing: { 'v/m': { prompt: 0, completion: 0 } }, budgetUsd: 0.000001 });
		expect(assertWithinBudget(cheap, prices).maxUsd).toBe(0);
	});
});
