import { describe, expect, it } from 'vitest';
import { compareRows, percentile, summarize, summarizeRows } from '../src/aggregate.ts';
import type { ResultsFile, ScoredRecord } from '../src/types.ts';
import { scored } from './helpers.ts';

const usage = (costUsd: number | null, cachedTokens: number | null = 0, inputTokens: number | null = 100) => ({
	inputTokens,
	outputTokens: 10,
	cachedTokens,
	costUsd
});

const file = (records: ScoredRecord[], over: Partial<ResultsFile['plan']> = {}): ResultsFile => ({
	schemaVersion: 1,
	name: 'n',
	task: 't',
	provenance: 'illustrative-fixture',
	createdAt: '2026-01-01T00:00:00Z',
	budgetUsd: 1,
	plan: { models: ['a/x', 'b/y'], variants: ['v1'], cases: ['c1', 'c2'], rounds: 2, ...over },
	records
});

describe('percentile', () => {
	it('interpolates and handles empty input', () => {
		expect(percentile([], 50)).toBeNull();
		expect(percentile([3, 1, 2], 50)).toBe(2);
		expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
		expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 95)).toBeCloseTo(10.5);
	});
});

describe('summarizeRows', () => {
	const records = [
		scored(true, { model: 'a/x', caseId: 'c1', round: 1, latencyMs: 1000, usage: usage(0.002, 0) }),
		scored(true, { model: 'a/x', caseId: 'c1', round: 2, latencyMs: 3000, usage: usage(0.002, 80) }),
		scored(true, { model: 'a/x', caseId: 'c2', round: 1, latencyMs: 2000, usage: usage(0.002, 90) }),
		scored(false, { model: 'a/x', caseId: 'c2', round: 2, latencyMs: 4000, usage: usage(0.002, null, null) })
	];
	const row = summarizeRows(records, 'a/x', 'v1');

	it('counts validity and pass^k separately', () => {
		expect(row.valid).toBe(3);
		expect(row.validRate).toBe(0.75);
		// c2 failed in round 2, so only c1 was valid in every round.
		expect(row.allRoundsValid).toBe(1);
		expect(row.cases).toBe(2);
	});

	it('prices a valid output by total spend over valid outputs', () => {
		expect(row.costUsd).toBeCloseTo(0.008);
		expect(row.costPerValidUsd).toBeCloseTo(0.008 / 3);
	});

	it('computes cache share only over calls that reported it', () => {
		expect(row.cacheReadShare).toBeCloseTo(170 / 300);
	});

	it('groups failures by reason', () => {
		expect(row.failures).toEqual({ schema: 1 });
	});

	it('has no cost per valid output when cost was never reported', () => {
		const r = summarizeRows([scored(true, { usage: usage(null) })], 'vendor/model', 'v1');
		expect(r.costPerValidUsd).toBeNull();
	});
});

describe('ranking', () => {
	const base = summarizeRows([scored(true)], 'vendor/model', 'v1');
	it('ranks validity first, then cost per valid output, then latency', () => {
		const a = { ...base, validRate: 1, costPerValidUsd: 0.01 };
		const b = { ...base, validRate: 0.9, costPerValidUsd: 0.0001 };
		const c = { ...base, validRate: 1, costPerValidUsd: 0.005 };
		const d = { ...base, validRate: 1, costPerValidUsd: 0.005, medianLatencyMs: 1 };
		expect([a, b, c, d].sort(compareRows)).toEqual([d, c, a, b]);
	});
});

describe('summarize', () => {
	it('sorts rows within each variant and picks a winner', () => {
		const records = [
			scored(false, { model: 'a/x', caseId: 'c1' }),
			scored(true, { model: 'a/x', caseId: 'c2' }),
			scored(true, { model: 'b/y', caseId: 'c1' }),
			scored(true, { model: 'b/y', caseId: 'c2' })
		];
		const s = summarize(file(records, { rounds: 1 }));
		expect(s.rows.map((r) => r.model)).toEqual(['b/y', 'a/x']);
		expect(s.winner?.model).toBe('b/y');
		expect(s.variants[0]).toMatchObject({ valid: 3, calls: 4, failures: { schema: 1 } });
		expect(s.spentUsd).toBeCloseTo(0.004);
	});

	it('leaves skipped calls out of the denominators', () => {
		const records = [scored(true, { model: 'a/x' }), scored(false, { model: 'a/x', status: 'skipped', caseId: 'c2' })];
		const s = summarize(file(records, { models: ['a/x'], rounds: 1 }));
		expect(s.rows[0]).toMatchObject({ calls: 1, valid: 1, validRate: 1 });
		expect(s.calls).toBe(1);
	});
});
