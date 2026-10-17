#!/usr/bin/env node
/**
 * llm-bakeoff CLI.
 *
 *   --config <file>                  live run (needs OPENROUTER_API_KEY)
 *   --config <file> --dry-run        print the plan and worst-case cost; no model is called
 *   --config <file> --replay <json>  re-score recorded outputs with the config's scorers; offline
 *   --report <json>                  print a results file as recorded; offline
 *   --out <dir>                      where results.json and report.md go (default results/<time>)
 *
 * The report goes to stdout; progress and file paths go to stderr, so stdout is exactly
 * the report (which is what `assets/terminal.svg` is rendered from).
 */
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { summarize } from './aggregate.ts';
import { assertWithinBudget, BudgetExceededError, countCalls, estimateMaxCost } from './budget.ts';
import { loadConfig } from './config.ts';
import { openRouter } from './openrouter.ts';
import { readResults, writeText } from './results-file.ts';
import { renderJson } from './reporters/json.ts';
import { renderMarkdown } from './reporters/markdown.ts';
import { colorize, renderTerminal } from './reporters/terminal.ts';
import { runBakeoff } from './runner.ts';
import { scoreAll } from './score.ts';
import type { BakeoffConfig, Price, ResultsFile } from './types.ts';

const err = (line = '') => process.stderr.write(`${line}\n`);

async function main(): Promise<number> {
	// Read OPENROUTER_API_KEY from .env when there is one. Node >= 20.12 has this built in.
	try {
		process.loadEnvFile('.env');
	} catch {
		// No .env file: the environment is used as it is.
	}
	const { values } = parseArgs({
		options: {
			config: { type: 'string' },
			replay: { type: 'string' },
			report: { type: 'string' },
			out: { type: 'string' },
			'dry-run': { type: 'boolean', default: false },
			'no-color': { type: 'boolean', default: false },
			help: { type: 'boolean', short: 'h', default: false }
		}
	});
	const color = process.stdout.isTTY && !values['no-color'] && !process.env.NO_COLOR;
	const outDir = values.out ?? join('results', new Date().toISOString().replace(/[:.]/g, '-'));

	if (values.help || (!values.config && !values.report)) {
		err('usage: npm run bakeoff -- --config <file> [--dry-run | --replay <results.json>] [--out <dir>]');
		err('       npm run bakeoff -- --report <results.json>');
		return values.help ? 0 : 2;
	}

	let results: ResultsFile;
	let source: string | undefined;

	if (values.report) {
		results = await readResults(values.report);
		source = `report of ${values.report}`;
	} else {
		const config = await loadConfig(values.config as string);

		if (values.replay) {
			const recorded = await readResults(values.replay);
			results = { ...recorded, records: scoreAll(recorded.records, config.task) };
			source = `replay of ${values.replay}`;
		} else {
			const apiKey = process.env.OPENROUTER_API_KEY;
			const client = openRouter(apiKey ? { apiKey } : {});
			const prices = await pricesFor(config, client);

			if (values['dry-run']) return dryRun(config, prices);

			if (!apiKey) {
				err('OPENROUTER_API_KEY is not set. Copy .env.example to .env, add a key, and run with --env-file,');
				err('or try `npm run demo`, which needs no key.');
				return 2;
			}
			const estimate = assertWithinBudget(config, prices);
			err(`${estimate.calls} calls, worst case $${estimate.maxUsd.toFixed(4)} of a $${config.budgetUsd.toFixed(2)} budget.`);

			const records = await runBakeoff(config, {
				client,
				onRecord(r, done, total) {
					const verdict = r.status === 'ok' ? `${(r.latencyMs / 1000).toFixed(1)}s` : `${r.status}: ${r.error}`;
					err(`[${String(done).padStart(String(total).length)}/${total}] ${r.model} ${r.variant} ${r.caseId} r${r.round} ${verdict}`);
				}
			});
			results = {
				schemaVersion: 1,
				name: config.name,
				task: config.task.id,
				provenance: 'live-run',
				createdAt: new Date().toISOString(),
				budgetUsd: config.budgetUsd,
				plan: {
					models: config.models.map((m) => m.id),
					variants: config.task.variants.map((v) => v.id),
					cases: config.task.cases.map((c) => c.id),
					rounds: config.rounds
				},
				records: scoreAll(records, config.task)
			};
		}
	}

	const summary = summarize(results);
	const lines = renderTerminal(summary, source);
	process.stdout.write(`${(color ? colorize(lines) : lines).join('\n')}\n`);

	await writeText(join(outDir, 'results.json'), renderJson(results, summary));
	await writeText(join(outDir, 'report.md'), renderMarkdown(summary));
	err('');
	err(`wrote ${join(outDir, 'results.json')} and ${join(outDir, 'report.md')}`);
	return 0;
}

async function pricesFor(config: BakeoffConfig, client: ReturnType<typeof openRouter>): Promise<Record<string, Price>> {
	const missing = config.models.map((m) => m.id).filter((id) => !config.pricing?.[id]);
	return missing.length > 0 ? client.prices(missing) : {};
}

function dryRun(config: BakeoffConfig, prices: Record<string, Price>): number {
	const estimate = estimateMaxCost(config, prices);
	err(`Dry run: ${config.name}. No model is called.`);
	const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
	err(`${n(config.models.length, 'model')} × ${n(config.task.variants.length, 'prompt')} × ${n(config.task.cases.length, 'case')} × ${n(config.rounds, 'round')} = ${countCalls(config)} calls`);
	for (const m of estimate.perModel) {
		err(`  ${m.model.padEnd(36)} ${String(m.calls).padStart(4)} calls  worst case ${Number.isFinite(m.maxUsd) ? `$${m.maxUsd.toFixed(4)}` : 'unknown price'}`);
	}
	err(`Worst case $${estimate.maxUsd.toFixed(4)} against a $${config.budgetUsd.toFixed(2)} budget.`);
	try {
		assertWithinBudget(config, prices);
		err('Within budget: a live run would start.');
		return 0;
	} catch (error) {
		err(`A live run would refuse to start: ${error instanceof Error ? error.message : String(error)}`);
		return 1;
	}
}

main().then(
	(code) => process.exit(code),
	(error: unknown) => {
		err(error instanceof BudgetExceededError ? error.message : error instanceof Error ? (error.stack ?? error.message) : String(error));
		process.exit(1);
	}
);
