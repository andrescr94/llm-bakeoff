import type { CallRecord, ScoredRecord, ScoreResult } from '../src/types.ts';

export function call(overrides: Partial<CallRecord> = {}): CallRecord {
	return {
		model: 'vendor/model',
		variant: 'v1',
		caseId: 'c1',
		round: 1,
		status: 'ok',
		attempts: 1,
		latencyMs: 1000,
		output: '{}',
		usage: { inputTokens: 100, outputTokens: 50, cachedTokens: 0, costUsd: 0.001 },
		...overrides
	};
}

export function scored(valid: boolean, overrides: Partial<CallRecord> = {}, extra: ScoreResult[] = []): ScoredRecord {
	return {
		...call(overrides),
		scores: [{ scorer: 'schema', required: true, pass: valid, ...(valid ? {} : { reason: 'schema' }) }, ...extra]
	};
}
