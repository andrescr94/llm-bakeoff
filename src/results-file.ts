import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { ResultsFile } from './types.ts';

const nullableNumber = z.number().nullable();

const ScoreResultJson = z.object({
	scorer: z.string(),
	required: z.boolean(),
	pass: z.boolean().nullable(),
	reason: z.string().optional(),
	detail: z.string().optional()
});

const RecordJson = z.object({
	model: z.string(),
	variant: z.string(),
	caseId: z.string(),
	round: z.number().int().positive(),
	status: z.enum(['ok', 'error', 'skipped']),
	error: z.string().optional(),
	attempts: z.number().int().nonnegative(),
	latencyMs: z.number().nonnegative(),
	output: z.string().nullable(),
	usage: z.object({
		inputTokens: nullableNumber,
		outputTokens: nullableNumber,
		cachedTokens: nullableNumber,
		costUsd: nullableNumber
	}),
	servedBy: z.object({ model: z.string().optional(), provider: z.string().optional() }).optional(),
	scores: z.array(ScoreResultJson)
});

export const ResultsFileJson = z.object({
	schemaVersion: z.literal(1),
	name: z.string(),
	task: z.string(),
	provenance: z.enum(['live-run', 'recorded-run', 'illustrative-fixture']),
	note: z.string().optional(),
	createdAt: z.string(),
	budgetUsd: z.number(),
	plan: z.object({
		models: z.array(z.string()),
		variants: z.array(z.string()),
		cases: z.array(z.string()),
		rounds: z.number().int().positive()
	}),
	records: z.array(RecordJson)
});

export async function readResults(path: string): Promise<ResultsFile> {
	const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
	const parsed = ResultsFileJson.safeParse(raw);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		throw new Error(`${path} is not a results file: ${issue?.path.join('.')}: ${issue?.message}`);
	}
	return parsed.data as ResultsFile;
}

export async function writeText(path: string, text: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, text.endsWith('\n') ? text : `${text}\n`);
}
