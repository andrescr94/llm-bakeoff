/** Number formatting shared by every reporter, so the terminal and the Markdown always agree. */

export function pct(rate: number): string {
	return `${Math.round(rate * 100)}%`;
}

export function seconds(ms: number | null): string {
	return ms == null ? 'n/a' : `${(ms / 1000).toFixed(1)}s`;
}

export function usd(value: number | null, digits = 5): string {
	return value == null ? 'n/a' : `$${value.toFixed(digits)}`;
}

export function share(value: number | null): string {
	return value == null ? 'n/a' : pct(value);
}

export function provenanceLine(provenance: string, note: string | undefined): string {
	const label =
		provenance === 'illustrative-fixture'
			? 'ILLUSTRATIVE FIXTURE, not a measurement of any model'
			: provenance === 'recorded-run'
				? 'RECORDED RUN, real API results replayed from a file'
				: 'LIVE RUN';
	return note ? `${label}. ${note}` : label;
}

/** Plain left/right-aligned columns. Widths come from the content, not a magic number. */
export function columns(rows: string[][], align: ('l' | 'r')[]): string[] {
	const widths = align.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
	return rows.map((r) =>
		r
			.map((cell, i) => (align[i] === 'r' ? cell.padStart(widths[i] ?? 0) : cell.padEnd(widths[i] ?? 0)))
			.join('  ')
			.trimEnd()
	);
}

export function wrap(text: string, width: number): string[] {
	const lines: string[] = [];
	let line = '';
	for (const word of text.split(/\s+/)) {
		if (line && line.length + 1 + word.length > width) {
			lines.push(line);
			line = word;
		} else line = line ? `${line} ${word}` : word;
	}
	if (line) lines.push(line);
	return lines;
}
