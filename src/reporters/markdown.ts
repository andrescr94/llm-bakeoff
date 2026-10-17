import type { Summary } from '../aggregate.ts';
import { provenanceLine, seconds, usd } from './format.ts';
import { informationalTotals, visibleColumns } from './terminal.ts';

const cell = (s: string) => s.replace(/\|/g, '\\|');

/** The same report as the terminal, as a Markdown file you can paste into a PR or a doc. */
export function renderMarkdown(summary: Summary): string {
	const { plan } = summary;
	const lines: string[] = [];
	lines.push(`# Bake-off: ${summary.name}`);
	lines.push('');
	lines.push(`> **${provenanceLine(summary.provenance, summary.note)}**`);
	lines.push('');
	lines.push(
		`${plan.models.length} models × ${plan.cases.length} cases × ${plan.rounds} rounds × ${plan.variants.length} prompts = **${summary.calls} calls**. ` +
			`Reported cost **${usd(summary.spentUsd, 4)}** (sum of \`usage.cost\`), budget ${usd(summary.budgetUsd, 2)}.`
	);

	const cols = visibleColumns(summary);
	for (const variant of plan.variants) {
		lines.push('');
		lines.push(`## Prompt: \`${variant}\``);
		lines.push('');
		lines.push(`| ${cols.map((c) => c.header || 'rate').join(' | ')} |`);
		lines.push(`|${cols.map((c) => (c.align === 'r' ? '---:' : '---')).join('|')}|`);
		summary.rows
			.filter((r) => r.variant === variant)
			.forEach((r, i) => {
				lines.push(`| ${cols.map((c) => cell(c.value(r, i + 1))).join(' | ')} |`);
			});
	}

	lines.push('');
	lines.push('## Why outputs failed');
	lines.push('');
	lines.push('First required check that failed, per invalid output.');
	lines.push('');
	lines.push('| prompt | reason | count |');
	lines.push('|---|---|---:|');
	let any = false;
	for (const v of summary.variants) {
		for (const [reason, n] of Object.entries(v.failures).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
			any = true;
			lines.push(`| \`${v.variant}\` | ${cell(reason)} | ${n} |`);
		}
	}
	if (!any) lines.push('| | none | 0 |');

	const signals = informationalTotals(summary);
	if (signals.length > 0) {
		lines.push('');
		lines.push('## Reported, not gating');
		lines.push('');
		lines.push('| prompt | scorer | passed / applied |');
		lines.push('|---|---|---:|');
		for (const x of signals) lines.push(`| \`${x.variant}\` | ${cell(x.scorer)} | ${x.pass}/${x.applied} |`);
	}

	if (summary.winner) {
		const w = summary.winner;
		lines.push('');
		lines.push(
			`**Winner:** \`${w.model}\` on \`${w.variant}\`, ${w.valid}/${w.calls} valid, ${usd(w.costPerValidUsd)} per valid output, ${seconds(w.medianLatencyMs)} median.`
		);
	}
	lines.push('');
	lines.push(
		'_Ranking: valid rate, then cost per valid output, then median latency. "All rounds" counts cases valid in every round (pass^k)._'
	);
	return lines.join('\n');
}
