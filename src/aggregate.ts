import { failureReason, isValid } from './score.ts';
import type { ResultsFile, ScoredRecord } from './types.ts';

/** One row of the report: one model under one prompt variant. */
export interface ModelSummary {
	model: string;
	variant: string;
	calls: number;
	valid: number;
	validRate: number;
	/**
	 * Cases that were valid in *every* round (pass^k). The honest reliability number:
	 * a model that passes each case once has not been shown to be reliable.
	 */
	allRoundsValid: number;
	cases: number;
	medianLatencyMs: number | null;
	p95LatencyMs: number | null;
	/** Sum of reported `usage.cost` over calls that reported one. */
	costUsd: number;
	/** What one usable output really costs: total spend ÷ valid outputs. */
	costPerValidUsd: number | null;
	/** Cached input tokens ÷ input tokens, over calls that reported both. */
	cacheReadShare: number | null;
	failures: Record<string, number>;
	/** Pass rate of each non-required scorer, over calls where it applied. */
	informational: Record<string, { pass: number; applied: number }>;
}

export interface VariantSummary {
	variant: string;
	calls: number;
	valid: number;
	validRate: number;
	failures: Record<string, number>;
}

export interface Summary {
	name: string;
	task: string;
	provenance: ResultsFile['provenance'];
	note?: string;
	budgetUsd: number;
	plan: ResultsFile['plan'];
	calls: number;
	spentUsd: number;
	/** Sorted best first within each variant, variants in plan order. */
	rows: ModelSummary[];
	variants: VariantSummary[];
	winner: ModelSummary | null;
}

export function percentile(values: number[], p: number): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	// Nearest-rank on a 0-based index with linear interpolation; p50 of an even set is the mean of the middle two.
	const rank = (p / 100) * (sorted.length - 1);
	const lo = Math.floor(rank);
	const hi = Math.ceil(rank);
	const a = sorted[lo] as number;
	const b = sorted[hi] as number;
	return a + (b - a) * (rank - lo);
}

/**
 * Ranking: most valid first; then cheapest per valid output; then fastest median.
 * Validity leads because an invalid output costs a retry and a waiting user; among valid
 * models, price per *usable* output is what the bill is made of.
 */
export function compareRows(a: ModelSummary, b: ModelSummary): number {
	if (b.validRate !== a.validRate) return b.validRate - a.validRate;
	const ca = a.costPerValidUsd ?? Number.POSITIVE_INFINITY;
	const cb = b.costPerValidUsd ?? Number.POSITIVE_INFINITY;
	if (ca !== cb) return ca - cb;
	return (a.medianLatencyMs ?? Number.POSITIVE_INFINITY) - (b.medianLatencyMs ?? Number.POSITIVE_INFINITY);
}

function countFailures(records: ScoredRecord[]): Record<string, number> {
	const out: Record<string, number> = {};
	for (const r of records) {
		const reason = failureReason(r);
		if (reason) out[reason] = (out[reason] ?? 0) + 1;
	}
	return out;
}

export function summarizeRows(records: ScoredRecord[], model: string, variant: string): ModelSummary {
	const rows = records.filter((r) => r.model === model && r.variant === variant);
	const ran = rows.filter((r) => r.status !== 'skipped');
	const valid = ran.filter(isValid).length;
	const latencies = ran.map((r) => r.latencyMs);
	const costUsd = ran.reduce((sum, r) => sum + (r.usage.costUsd ?? 0), 0);
	const costKnown = ran.some((r) => r.usage.costUsd != null);

	const cacheRows = ran.filter((r) => r.usage.cachedTokens != null && r.usage.inputTokens);
	const cached = cacheRows.reduce((s, r) => s + (r.usage.cachedTokens ?? 0), 0);
	const input = cacheRows.reduce((s, r) => s + (r.usage.inputTokens ?? 0), 0);

	const byCase = new Map<string, boolean>();
	for (const r of rows) byCase.set(r.caseId, (byCase.get(r.caseId) ?? true) && isValid(r));

	const informational: ModelSummary['informational'] = {};
	for (const r of ran) {
		for (const s of r.scores) {
			if (s.required || s.pass === null) continue;
			const entry = (informational[s.scorer] ??= { pass: 0, applied: 0 });
			entry.applied++;
			if (s.pass) entry.pass++;
		}
	}

	return {
		model,
		variant,
		calls: ran.length,
		valid,
		validRate: ran.length ? valid / ran.length : 0,
		allRoundsValid: [...byCase.values()].filter(Boolean).length,
		cases: byCase.size,
		medianLatencyMs: percentile(latencies, 50),
		p95LatencyMs: percentile(latencies, 95),
		costUsd,
		costPerValidUsd: costKnown && valid > 0 ? costUsd / valid : null,
		cacheReadShare: input > 0 ? cached / input : null,
		failures: countFailures(ran),
		informational
	};
}

export function summarize(results: ResultsFile): Summary {
	const { records, plan } = results;
	const rows: ModelSummary[] = [];
	const variants: VariantSummary[] = [];

	for (const variant of plan.variants) {
		const inVariant = records.filter((r) => r.variant === variant && r.status !== 'skipped');
		const valid = inVariant.filter(isValid).length;
		variants.push({
			variant,
			calls: inVariant.length,
			valid,
			validRate: inVariant.length ? valid / inVariant.length : 0,
			failures: countFailures(inVariant)
		});
		rows.push(...plan.models.map((m) => summarizeRows(records, m, variant)).sort(compareRows));
	}

	const winner = [...rows].sort(compareRows)[0] ?? null;
	return {
		name: results.name,
		task: results.task,
		provenance: results.provenance,
		...(results.note ? { note: results.note } : {}),
		budgetUsd: results.budgetUsd,
		plan,
		calls: records.filter((r) => r.status !== 'skipped').length,
		spentUsd: records.reduce((sum, r) => sum + (r.usage.costUsd ?? 0), 0),
		rows,
		variants,
		winner
	};
}
