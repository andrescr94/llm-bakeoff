/**
 * Renders the README images from data, so no picture can drift from the numbers:
 *
 *   assets/results-light.svg, results-dark.svg   chart of the real case-study results file
 *   assets/terminal.svg                           exactly what `npm run demo` prints
 *   assets/social-preview.png                     1280×640, via headless Chrome if installed (--png)
 *
 *   npm run assets            # SVGs; a test fails if the committed copies are stale
 *   npm run assets -- --png   # also the social preview PNG
 *
 * The banner SVGs are hand-drawn and live in assets/ as they are.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { task } from '../examples/intake-form/task.ts';
import { summarize, type Summary } from '../src/aggregate.ts';
import { readResults } from '../src/results-file.ts';
import { renderTerminal } from '../src/reporters/terminal.ts';
import { scoreAll } from '../src/score.ts';

const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));

export const DEMO_FIXTURE = 'examples/intake-form/recorded/demo-run.json';
export const CASE_STUDY = 'case-study/followform-exp01.results.json';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace`;

/** The demo report, built by the same calls the CLI makes for `--replay`. */
export async function demoLines(): Promise<string[]> {
	const recorded = await readResults(root(DEMO_FIXTURE));
	const results = { ...recorded, records: scoreAll(recorded.records, task) };
	return renderTerminal(summarize(results), `replay of ${DEMO_FIXTURE}`);
}

export function terminalSvg(lines: string[]): string {
	const charW = 7.85;
	const lineH = 19;
	const padX = 24;
	const top = 52;
	const width = Math.ceil(Math.max(...lines.map((l) => l.length)) * charW + padX * 2);
	const height = top + lines.length * lineH + 24;
	// Lines between the title and the first blank line are the provenance note.
	const provenanceEnd = lines.indexOf('');
	const colour = (line: string, i: number): { fill: string; weight: number } => {
		if (i === 0) return { fill: '#f0f6fc', weight: 700 };
		if (i < provenanceEnd) return { fill: '#e3b341', weight: 400 };
		if (/^(Prompt|Why outputs|Reported, not)/.test(line)) return { fill: '#f0f6fc', weight: 700 };
		if (line.startsWith('Winner:')) return { fill: '#56d364', weight: 700 };
		if (/^\s+#\s+model/.test(line)) return { fill: '#8b949e', weight: 400 };
		return { fill: '#c9d1d9', weight: 400 };
	};
	const text = lines
		.map((line, i) => {
			const { fill, weight } = colour(line, i);
			return `<text x="${padX}" y="${top + (i + 1) * lineH - 5}" fill="${fill}" font-weight="${weight}" xml:space="preserve">${esc(line)}</text>`;
		})
		.join('\n  ');
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="t d">
  <title id="t">Output of npm run demo</title>
  <desc id="d">${esc(lines.join(' / '))}</desc>
  <rect width="${width}" height="${height}" rx="10" fill="#0d1117"/>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="none" stroke="#30363d"/>
  <circle cx="22" cy="20" r="6" fill="#ff5f57"/><circle cx="42" cy="20" r="6" fill="#febc2e"/><circle cx="62" cy="20" r="6" fill="#28c840"/>
  <text x="${width / 2}" y="25" text-anchor="middle" fill="#8b949e" font-family="${SANS}" font-size="12">npm run demo</text>
  <g font-family="${MONO}" font-size="13">
  ${text}
  </g>
</svg>
`;
}

interface Theme {
	surface: string;
	border: string;
	text: string;
	secondary: string;
	muted: string;
	grid: string;
	before: string;
	after: string;
}

export const THEMES: Record<'light' | 'dark', Theme> = {
	light: { surface: '#fcfcfb', border: '#e6e5e1', text: '#0b0b0b', secondary: '#52514e', muted: '#7b7a75', grid: '#e6e5e1', before: '#eb6834', after: '#2a78d6' },
	dark: { surface: '#1a1a19', border: '#383835', text: '#ffffff', secondary: '#c3c2b7', muted: '#9c9b93', grid: '#383835', before: '#d95926', after: '#3987e5' }
};

/** A bar with a 4px rounded data end, square on the baseline. */
function bar(x: number, y: number, w: number, h: number, fill: string): string {
	if (w <= 0) return '';
	const r = Math.min(4, w, h / 2);
	return `<path d="M${x} ${y}h${w - r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 -${r} ${r}h-${w - r}z" fill="${fill}"/>`;
}

export function resultsSvg(summary: Summary, theme: Theme): string {
	const [before, after] = summary.plan.variants as [string, string];
	const rowsAfter = summary.rows.filter((r) => r.variant === after);
	const rowOf = (model: string, variant: string) => summary.rows.find((r) => r.model === model && r.variant === variant);
	const cases = summary.plan.cases.length * summary.plan.rounds;
	const vBefore = summary.variants.find((v) => v.variant === before);
	const vAfter = summary.variants.find((v) => v.variant === after);

	const W = 880;
	const x0 = 300;
	const scaleW = 300;
	const unit = scaleW / cases;
	const rowH = 54;
	const rowsTop = 150;
	const H = rowsTop + rowsAfter.length * rowH + 92;
	const medianX = 760;
	const costX = 848;

	const grid = Array.from({ length: cases + 1 }, (_, i) => {
		const x = x0 + i * unit;
		return `<line x1="${x}" y1="${rowsTop - 8}" x2="${x}" y2="${rowsTop + rowsAfter.length * rowH - 6}" stroke="${theme.grid}" stroke-width="1"/>
    <text x="${x}" y="${rowsTop + rowsAfter.length * rowH + 12}" text-anchor="middle" fill="${theme.muted}" font-size="12">${i}</text>`;
	}).join('\n    ');

	const rows = rowsAfter
		.map((r, i) => {
			const y = rowsTop + i * rowH;
			const b = rowOf(r.model, before);
			const vb = b?.valid ?? 0;
			const va = r.valid;
			return `<g>
      <title>${esc(r.model)}: ${vb}/${cases} valid on the original prompt, ${va}/${cases} with the options rule</title>
      <text x="32" y="${y + 20}" fill="${theme.text}" font-size="14" font-family="${MONO}">${esc(r.model)}</text>
      ${bar(x0, y + 2, vb * unit, 14, theme.before)}
      <text x="${x0 + vb * unit + 6}" y="${y + 14}" fill="${theme.secondary}" font-size="12">${vb}/${cases}</text>
      ${bar(x0, y + 18, va * unit, 14, theme.after)}
      <text x="${x0 + va * unit + 6}" y="${y + 30}" fill="${theme.text}" font-size="12" font-weight="600">${va}/${cases}</text>
      <text x="${medianX}" y="${y + 24}" text-anchor="end" fill="${theme.text}" font-size="14">${r.medianLatencyMs == null ? 'n/a' : `${Math.round(r.medianLatencyMs / 1000)} s`}</text>
      <text x="${costX}" y="${y + 24}" text-anchor="end" fill="${theme.text}" font-size="14">${r.costPerValidUsd == null ? 'n/a' : `$${r.costPerValidUsd.toFixed(4)}`}</text>
    </g>`;
		})
		.join('\n    ');

	const pctOf = (v: typeof vBefore) => (v ? `${v.valid}/${v.calls} (${Math.round(v.validRate * 100)}%)` : 'n/a');

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
  <title id="t">Valid outputs per model, before and after one prompt paragraph</title>
  <desc id="d">Real run, 2026-09-06. ${rowsAfter
		.map((r) => `${r.model}: ${rowOf(r.model, before)?.valid ?? 0} then ${r.valid} of ${cases}`)
		.join('; ')}. Total ${pctOf(vBefore)} to ${pctOf(vAfter)}.</desc>
  <rect width="${W}" height="${H}" rx="12" fill="${theme.surface}"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="${theme.border}"/>
  <g font-family="${SANS}">
    <text x="32" y="44" fill="${theme.text}" font-size="20" font-weight="700">Valid outputs, before and after one prompt paragraph</text>
    <text x="32" y="68" fill="${theme.secondary}" font-size="13">Real run, 2026-09-06 · 4 models × 5 briefs per prompt · scored in code</text>
    ${bar(32, 90, 14, 12, theme.before)}<text x="52" y="101" fill="${theme.secondary}" font-size="13">original prompt</text>
    ${bar(170, 90, 14, 12, theme.after)}<text x="190" y="101" fill="${theme.secondary}" font-size="13">+ one paragraph: options only on choice fields</text>
    <text x="${x0}" y="132" fill="${theme.muted}" font-size="12">valid outputs (of ${cases})</text>
    <text x="${medianX}" y="132" text-anchor="end" fill="${theme.muted}" font-size="12">median time</text>
    <text x="${costX}" y="132" text-anchor="end" fill="${theme.muted}" font-size="12">$ / valid</text>
    ${grid}
    ${rows}
    <text x="32" y="${H - 44}" fill="${theme.text}" font-size="14" font-weight="600">All models: ${pctOf(vBefore)} → ${pctOf(vAfter)} valid</text>
    <text x="32" y="${H - 22}" fill="${theme.muted}" font-size="12">Time and cost are with the paragraph; $ / valid counts successful calls only. Data: ${CASE_STUDY}</text>
  </g>
</svg>
`;
}

export async function renderAll(): Promise<Record<string, string>> {
	const summary = summarize(await readResults(root(CASE_STUDY)));
	return {
		'assets/results-light.svg': resultsSvg(summary, THEMES.light),
		'assets/results-dark.svg': resultsSvg(summary, THEMES.dark),
		'assets/terminal.svg': terminalSvg(await demoLines())
	};
}

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function renderPng(svgPath: string, pngPath: string): void {
	const chrome = [process.env.CHROME_PATH, CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p));
	if (!chrome) {
		console.log('No Chrome or Chromium found; skipped the social preview PNG.');
		return;
	}
	const html = root('results/social-preview.html');
	writeFileSync(
		html,
		`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#0d1117}</style></head><body>${readFileSync(svgPath, 'utf8')}</body></html>`
	);
	execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--screenshot=${pngPath}`, '--window-size=1280,640', `file://${html}`], { stdio: 'ignore' });
	console.log(`wrote ${pngPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	for (const [path, svg] of Object.entries(await renderAll())) {
		writeFileSync(root(path), svg);
		console.log(`wrote ${path}`);
	}
	if (process.argv.includes('--png')) {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(root('results'), { recursive: true });
		renderPng(root('assets/social-preview.svg'), root('assets/social-preview.png'));
	}
}
