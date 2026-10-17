import { ApiError, type OpenRouterClient } from './openrouter.ts';
import { mapPool, withRetry } from './pool.ts';
import type { BakeoffConfig, CallRecord } from './types.ts';

export interface Job {
	model: string;
	variant: string;
	caseId: string;
	round: number;
}

/**
 * Every call the config asks for, in the order they are started.
 *
 * Rounds go outermost so a run cut short by the budget has complete rounds rather than a
 * complete model. Models go innermost so concurrent calls spread over several providers
 * instead of hammering one, and each model sees the same prompt prefix again soon, which
 * is when a prompt cache can be hit.
 */
export function planJobs(config: BakeoffConfig): Job[] {
	const jobs: Job[] = [];
	for (let round = 1; round <= config.rounds; round++) {
		for (const variant of config.task.variants) {
			for (const c of config.task.cases) {
				for (const model of config.models) {
					jobs.push({ model: model.id, variant: variant.id, caseId: c.id, round });
				}
			}
		}
	}
	return jobs;
}

export function isRetryable(error: unknown): boolean {
	if (error instanceof ApiError) return error.retryable;
	if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return true;
	// `fetch` rejects with a TypeError on network failure.
	return error instanceof TypeError;
}

export interface RunOptions {
	client: OpenRouterClient;
	onRecord?: (record: CallRecord, done: number, total: number) => void;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
	retryBaseDelayMs?: number;
}

/**
 * Run the matrix. Never throws for a single bad call: a timeout or an HTTP error becomes a
 * record with `status: 'error'`, because a failure is a measurement too.
 *
 * Spend is summed from `usage.cost` as calls return; once it reaches the budget no new
 * call starts, and the rest are recorded as `skipped`.
 */
export async function runBakeoff(config: BakeoffConfig, options: RunOptions): Promise<CallRecord[]> {
	const now = options.now ?? (() => performance.now());
	const jobs = planJobs(config);
	const systemOf = new Map(config.task.variants.map((v) => [v.id, v.system]));
	const userOf = new Map(config.task.cases.map((c) => [c.id, c.user]));
	const paramsOf = new Map(config.models.map((m) => [m.id, m.params]));
	let spentUsd = 0;
	let done = 0;

	return mapPool(jobs, config.concurrency, async (job) => {
		const base = { ...job, usage: { inputTokens: null, outputTokens: null, cachedTokens: null, costUsd: null } };
		let record: CallRecord;

		if (spentUsd >= config.budgetUsd) {
			record = { ...base, status: 'skipped', error: 'budget reached', attempts: 0, latencyMs: 0, output: null };
		} else {
			let started = now();
			try {
				const params = paramsOf.get(job.model);
				const { value, attempts } = await withRetry(
					() => {
						started = now();
						return options.client.complete({
							model: job.model,
							messages: [
								{ role: 'system', content: systemOf.get(job.variant) ?? '' },
								{ role: 'user', content: userOf.get(job.caseId) ?? '' }
							],
							maxOutputTokens: config.maxOutputTokens,
							...(config.temperature === undefined ? {} : { temperature: config.temperature }),
							...(config.task.responseFormat ? { responseFormat: config.task.responseFormat } : {}),
							requireParameters: config.requireParameters ?? true,
							...(params ? { params } : {}),
							signal: AbortSignal.timeout(config.timeoutMs)
						});
					},
					{
						retries: config.retries,
						baseDelayMs: options.retryBaseDelayMs ?? 1000,
						isRetryable,
						...(options.sleep ? { sleep: options.sleep } : {})
					}
				);
				spentUsd += value.usage.costUsd ?? 0;
				record = {
					...base,
					status: 'ok',
					attempts,
					latencyMs: Math.round(now() - started),
					output: value.text,
					usage: value.usage,
					servedBy: value.servedBy
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const attempts = (error as { attempts?: number }).attempts ?? 1;
				record = { ...base, status: 'error', error: message, attempts, latencyMs: Math.round(now() - started), output: null };
			}
		}

		done++;
		options.onRecord?.(record, done, jobs.length);
		return record;
	});
}
