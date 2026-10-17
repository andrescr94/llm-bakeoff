import type { ModelSummary, Summary } from '../aggregate.ts';
import { columns, pct, provenanceLine, seconds, share, usd, wrap } from './format.ts';

/**
 * The report a person reads in a terminal. Returns plain text lines; colour, if any, is
 * added by the caller, so `assets/terminal.svg` can be rendered from exactly this output.
 */
export function renderTerminal(summary: Summary, source?: string): string[] {
	const { plan } = summary;
	const out: string[] = [];
	out.push(`llm-bakeoff · ${summary.name}${source ? ` · ${source}` : ''}`);
	out.push(...wrap(provenanceLine(summary.provenance, summary.note), 96));
	out.push('');
	const dims = [
		`${plan.models.length} models`,
		`${plan.cases.length} cases`,
		`${plan.rounds} round${plan.rounds === 1 ? '' : 's'}`,
		`${plan.variants.length} prompt${plan.variants.length === 1 ? '' : 's'}`
	];
	out.push(`${dims.join(' × ')} = ${summary.calls} calls · reported cost ${usd(summary.spentUsd, 4)} · budget ${usd(summary.budgetUsd, 2)}`);

	const cols = visibleColumns(summary);
	for (const variant of plan.variants) {
		const rows = summary.rows.filter((r) => r.variant === variant);
		out.push('');
		out.push(`Prompt: ${variant}`);
		const table = [cols.map((c) => c.header), ...rows.map((r, i) => cols.map((c) => c.value(r, i + 1)))];
		out.push(...columns(table, cols.map((c) => c.align)).map((l) => `  ${l}`));
	}

	if (plan.variants.length > 1) {
		out.push('');
		out.push('Prompt comparison');
		out.push(
			...columns(
				summary.variants.map((v) => [v.variant, `${v.valid}/${v.calls}`, pct(v.validRate)]),
				['l', 'r', 'r']
			).map((l) => `  ${l}`)
		);
	}

	const failing = summary.variants.filter((v) => Object.keys(v.failures).length > 0);
	if (failing.length > 0) {
		out.push('');
		out.push('Why outputs failed (first required check that failed)');
		const lines: string[][] = [];
		for (const v of failing) {
			const sorted = Object.entries(v.failures).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
			for (const [reason, n] of sorted) lines.push([v.variant, reason, String(n)]);
		}
		out.push(...columns(lines, ['l', 'l', 'r']).map((l) => `  ${l}`));
	}

	const signals = informationalTotals(summary);
	if (signals.length > 0) {
		out.push('');
		out.push('Reported, not gating (passed / applied)');
		out.push(...columns(signals.map((x) => [x.variant, x.scorer, `${x.pass}/${x.applied}`]), ['l', 'l', 'r']).map((l) => `  ${l}`));
	}

	const w = summary.winner;
	if (w) {
		out.push('');
		out.push(
			`Winner: ${w.model} on ${w.variant}, ${w.valid}/${w.calls} valid, ${usd(w.costPerValidUsd)} per valid output, ${seconds(w.medianLatencyMs)} median.`
		);
	}
	return out;
}

/** Non-required scorers summed over models, per variant, in scorer order. */
export function informationalTotals(summary: Summary): { variant: string; scorer: string; pass: number; applied: number }[] {
	const out: { variant: string; scorer: string; pass: number; applied: number }[] = [];
	for (const variant of summary.plan.variants) {
		const totals = new Map<string, { pass: number; applied: number }>();
		for (const row of summary.rows.filter((r) => r.variant === variant)) {
			for (const [scorer, v] of Object.entries(row.informational)) {
				const t = totals.get(scorer) ?? { pass: 0, applied: 0 };
				totals.set(scorer, { pass: t.pass + v.pass, applied: t.applied + v.applied });
			}
		}
		for (const [scorer, t] of totals) out.push({ variant, scorer, ...t });
	}
	return out;
}

interface Column {
	header: string;
	align: 'l' | 'r';
	value: (r: ModelSummary, rank: number) => string;
}

/**
 * Columns that carry information for this run. "All rounds" says nothing with one round,
 * and "cache read" says nothing when no call reported cached tokens, so both drop out.
 */
export function visibleColumns(summary: Summary): Column[] {
	const cols: Column[] = [
		{ header: '#', align: 'r', value: (_, rank) => String(rank) },
		{ header: 'model', align: 'l', value: (r) => r.model },
		{ header: 'valid', align: 'r', value: (r) => `${r.valid}/${r.calls}` },
		{ header: '', align: 'r', value: (r) => pct(r.validRate) }
	];
	if (summary.plan.rounds > 1) {
		cols.push({ header: 'all rounds', align: 'r', value: (r) => `${r.allRoundsValid}/${r.cases}` });
	}
	cols.push(
		{ header: 'median', align: 'r', value: (r) => seconds(r.medianLatencyMs) },
		{ header: 'p95', align: 'r', value: (r) => seconds(r.p95LatencyMs) },
		{ header: '$ / valid', align: 'r', value: (r) => usd(r.costPerValidUsd) }
	);
	if (summary.rows.some((r) => r.cacheReadShare != null)) {
		cols.push({ header: 'cache read', align: 'r', value: (r) => share(r.cacheReadShare) });
	}
	return cols;
}

const BOLD = '\u001b[1m';
const DIM = '\u001b[2m';
const YELLOW = '\u001b[33m';
const GREEN = '\u001b[32m';
const RESET = '\u001b[0m';

/** Light ANSI styling for a TTY. Same text, so it never disagrees with the plain report. */
export function colorize(lines: string[]): string[] {
	return lines.map((line, i) => {
		if (i === 0) return `${BOLD}${line}${RESET}`;
		if (/^(ILLUSTRATIVE|RECORDED|LIVE)/.test(line)) return `${YELLOW}${line}${RESET}`;
		if (/^(Prompt|Why outputs|Reported, not)/.test(line)) return `${BOLD}${line}${RESET}`;
		if (line.startsWith('Winner:')) return `${GREEN}${BOLD}${line}${RESET}`;
		if (/^\s+#\s+model/.test(line)) return `${DIM}${line}${RESET}`;
		return line;
	});
}
