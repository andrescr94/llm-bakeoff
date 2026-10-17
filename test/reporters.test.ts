import { describe, expect, it } from 'vitest';
import { summarize } from '../src/aggregate.ts';
import { renderMarkdown } from '../src/reporters/markdown.ts';
import { colorize, renderTerminal } from '../src/reporters/terminal.ts';
import type { ResultsFile } from '../src/types.ts';
import { scored } from './helpers.ts';

const results = (provenance: ResultsFile['provenance'], rounds = 1): ResultsFile => ({
	schemaVersion: 1,
	name: 'demo',
	task: 't',
	provenance,
	createdAt: '2026-01-01T00:00:00Z',
	budgetUsd: 0.4,
	plan: { models: ['vendor/model'], variants: ['v1'], cases: ['c1'], rounds },
	records: [scored(true, { usage: { inputTokens: 100, outputTokens: 1, cachedTokens: null, costUsd: 0.0012 } })]
});

describe('terminal reporter', () => {
	it('always says where the data came from', () => {
		expect(renderTerminal(summarize(results('illustrative-fixture')))[1]).toMatch(/^ILLUSTRATIVE FIXTURE/);
		expect(renderTerminal(summarize(results('recorded-run')))[1]).toMatch(/^RECORDED RUN/);
	});

	it('drops columns that carry no information', () => {
		const text = renderTerminal(summarize(results('live-run'))).join('\n');
		expect(text).not.toContain('all rounds');
		expect(text).not.toContain('cache read');
		expect(text).toContain('$0.00120');
		expect(renderTerminal(summarize(results('live-run', 2))).join('\n')).toContain('all rounds');
	});

	it('names the winner', () => {
		expect(renderTerminal(summarize(results('live-run'))).at(-1)).toMatch(/^Winner: vendor\/model on v1, 1\/1 valid/);
	});

	it('colours without changing the text', () => {
		const plain = renderTerminal(summarize(results('live-run')));
		const stripped = colorize(plain).map((l) => l.replace(/\u001b\[\d+m/g, ''));
		expect(stripped).toEqual(plain);
	});
});

describe('markdown reporter', () => {
	it('renders a table per prompt and the provenance as a callout', () => {
		const md = renderMarkdown(summarize(results('recorded-run')));
		expect(md).toContain('> **RECORDED RUN');
		expect(md).toContain('## Prompt: `v1`');
		expect(md).toMatch(/\| 1 \| vendor\/model \| 1\/1 \| 100% \|/);
		expect(md).toContain('**Winner:** `vendor/model`');
	});
});
