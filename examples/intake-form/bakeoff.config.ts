/**
 * The example bake-off: four inexpensive models, two prompt variants, five briefs, two rounds.
 *
 *   npm run bakeoff -- --config examples/intake-form/bakeoff.config.ts --dry-run   # plan + worst case, free
 *   npm run bakeoff -- --config examples/intake-form/bakeoff.config.ts             # live, needs OPENROUTER_API_KEY
 *
 * Model ids were checked against https://openrouter.ai/api/v1/models on 2026-10-16.
 * They move; re-check before a run.
 */
import { defineConfig } from '../../src/config.ts';
import { task } from './task.ts';

export default defineConfig({
	name: 'intake-form',
	task,
	models: [
		{ id: 'openai/gpt-5.6-luna' },
		{ id: 'qwen/qwen3.8-flash' },
		{ id: 'deepseek/deepseek-v4-flash-0731' },
		{ id: 'z-ai/glm-5.3-flash' }
	],
	rounds: 2,
	// Thinking models spend part of this on reasoning; too low a cap truncates their JSON.
	maxOutputTokens: 6000,
	concurrency: 4,
	timeoutMs: 240_000,
	retries: 1,
	// A cap on the *worst case* (every call at its full output cap, every call retried).
	// The case study this repo comes from had a $0.40 budget and spent $0.14; set this to
	// 0.4 and `--dry-run` shows the guard refusing this config.
	budgetUsd: 1
});
