import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { BakeoffConfig } from './types.ts';

/**
 * Validates the numbers and ids a person types into a config. The task's functions
 * (scorers) are checked for presence only; zod cannot say much about a function.
 */
const ConfigJson = z.object({
	name: z.string().min(1),
	models: z.array(z.object({ id: z.string().regex(/^[\w.-]+\/[\w.:-]+$/, 'expected vendor/model') })).min(1),
	rounds: z.number().int().min(1).max(20),
	maxOutputTokens: z.number().int().positive(),
	temperature: z.number().min(0).max(2).optional(),
	concurrency: z.number().int().min(1).max(32),
	timeoutMs: z.number().int().min(1000),
	retries: z.number().int().min(0).max(5),
	budgetUsd: z.number().positive(),
	task: z.object({
		id: z.string().min(1),
		variants: z.array(z.object({ id: z.string().min(1), system: z.string().min(1) })).min(1),
		cases: z.array(z.object({ id: z.string().min(1), user: z.string() })).min(1),
		scorers: z.array(z.object({ name: z.string().min(1), required: z.boolean() })).min(1)
	})
});

export function validateConfig(config: BakeoffConfig): BakeoffConfig {
	const result = ConfigJson.safeParse(config);
	if (!result.success) {
		const issue = result.error.issues[0];
		throw new Error(`Invalid config: ${issue?.path.join('.') || '(root)'}: ${issue?.message}`);
	}
	for (const [kind, list] of [
		['model', config.models.map((m) => m.id)],
		['variant', config.task.variants.map((v) => v.id)],
		['case', config.task.cases.map((c) => c.id)],
		['scorer', config.task.scorers.map((s) => s.name)]
	] as const) {
		const dup = list.find((id, i) => list.indexOf(id) !== i);
		if (dup) throw new Error(`Invalid config: ${kind} "${dup}" appears twice.`);
	}
	if (!config.task.scorers.some((s) => s.required)) {
		throw new Error('Invalid config: at least one scorer must be required, or nothing defines "valid".');
	}
	return config;
}

/** Identity with a type, so a config file gets autocompletion and type errors. */
export function defineConfig(config: BakeoffConfig): BakeoffConfig {
	return config;
}

/** Import a `.ts` config (the CLI runs under tsx) and validate it. */
export async function loadConfig(path: string): Promise<BakeoffConfig> {
	const mod = (await import(pathToFileURL(resolve(path)).href)) as { default?: BakeoffConfig };
	if (!mod.default) throw new Error(`${path} has no default export. Export defineConfig({...}).`);
	return validateConfig(mod.default);
}
