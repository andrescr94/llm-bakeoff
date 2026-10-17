/**
 * Guards that keep the repo honest: the committed demo fixture, the README images and the
 * real case-study numbers cannot drift from the code and data they claim to come from.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { summarize } from '../src/aggregate.ts';
import { readResults } from '../src/results-file.ts';
import { fixtureJson, FIXTURE_PATH } from '../scripts/make-demo-fixture.ts';
import { CASE_STUDY, renderAll } from '../scripts/render-assets.ts';

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

describe('committed artifacts', () => {
	it('the demo fixture is exactly what scripts/make-demo-fixture.ts generates', () => {
		expect(readFileSync(FIXTURE_PATH, 'utf8')).toBe(fixtureJson());
	});

	it('the demo fixture says it is illustrative', async () => {
		expect((await readResults(FIXTURE_PATH)).provenance).toBe('illustrative-fixture');
	});

	it('the README images are up to date with the data (run `npm run assets`)', async () => {
		for (const [path, svg] of Object.entries(await renderAll())) {
			expect(readFileSync(path, 'utf8'), path).toBe(svg);
		}
	});

	it('assets/terminal.svg shows exactly what `npm run demo` prints', () => {
		const out = mkdtempSync(join(tmpdir(), 'bakeoff-'));
		const stdout = execFileSync(
			process.execPath,
			['--import', 'tsx', 'src/cli.ts', '--config', 'examples/intake-form/bakeoff.config.ts', '--replay', 'examples/intake-form/recorded/demo-run.json', '--out', out, '--no-color'],
			{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
		);
		const svgLines = [...readFileSync('assets/terminal.svg', 'utf8').matchAll(/xml:space="preserve">(.*)<\/text>/g)].map((m) => unescape(m[1] ?? ''));
		expect(svgLines).toEqual(stdout.trimEnd().split('\n'));
	}, 30_000);
});

describe('case study data', () => {
	it('matches the 2026-09-06 run log: 14/20 valid, then 17/20 after the prompt paragraph', async () => {
		const summary = summarize(await readResults(CASE_STUDY));
		expect(summary.provenance).toBe('recorded-run');
		expect(summary.variants.map((v) => `${v.valid}/${v.calls}`)).toEqual(['14/20', '17/20']);
		expect(summary.variants[0]?.failures['options-only-on-choice']).toBe(3);
		expect(summary.variants[1]?.failures['options-only-on-choice']).toBeUndefined();
		expect(summary.winner?.model).toBe('openai/gpt-5.6-luna');
		expect(summary.winner?.costPerValidUsd).toBeCloseTo(0.00121, 5);
	});
});
