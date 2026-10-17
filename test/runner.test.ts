import { describe, expect, it } from 'vitest';
import { ApiError, type Completion, type CompletionRequest, type OpenRouterClient } from '../src/openrouter.ts';
import { mapPool, withRetry } from '../src/pool.ts';
import { planJobs, runBakeoff } from '../src/runner.ts';
import type { BakeoffConfig } from '../src/types.ts';

const config = (over: Partial<BakeoffConfig> = {}): BakeoffConfig => ({
	name: 'r',
	task: {
		id: 't',
		description: '',
		variants: [{ id: 'v1', system: 'sys' }],
		cases: [
			{ id: 'a', user: 'ua' },
			{ id: 'b', user: 'ub' }
		],
		scorers: [{ name: 's', required: true, score: () => ({ pass: true }) }]
	},
	models: [{ id: 'x/one' }, { id: 'x/two', params: { reasoning: { effort: 'low' } } }],
	rounds: 2,
	maxOutputTokens: 100,
	concurrency: 2,
	timeoutMs: 5000,
	retries: 2,
	budgetUsd: 1,
	...over
});

const ok = (text = '{}', costUsd = 0.001): Completion => ({
	text,
	usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0, costUsd },
	servedBy: { model: 'x/one', provider: 'P' }
});

function fakeClient(handler: (req: CompletionRequest, n: number) => Promise<Completion>): OpenRouterClient & { requests: CompletionRequest[] } {
	const requests: CompletionRequest[] = [];
	return {
		requests,
		complete: (req) => {
			requests.push(req);
			return handler(req, requests.length);
		},
		prices: async () => ({})
	};
}

const noSleep = async () => {};

describe('planJobs', () => {
	it('puts rounds outermost and models innermost', () => {
		const jobs = planJobs(config());
		expect(jobs).toHaveLength(8);
		expect(jobs.slice(0, 2).map((j) => j.model)).toEqual(['x/one', 'x/two']);
		expect(jobs.slice(0, 4).every((j) => j.round === 1)).toBe(true);
	});
});

describe('mapPool', () => {
	it('never exceeds the limit and keeps order', async () => {
		let inFlight = 0;
		let peak = 0;
		const out = await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
			inFlight++;
			peak = Math.max(peak, inFlight);
			await new Promise((r) => setTimeout(r, 5));
			inFlight--;
			return n * 10;
		});
		expect(out).toEqual([10, 20, 30, 40, 50]);
		expect(peak).toBe(2);
	});
});

describe('withRetry', () => {
	it('retries a retryable error and reports attempts', async () => {
		let n = 0;
		const result = await withRetry(
			async () => {
				if (++n < 3) throw new Error('flaky');
				return 'done';
			},
			{ retries: 2, baseDelayMs: 1, isRetryable: () => true, sleep: noSleep }
		);
		expect(result).toEqual({ value: 'done', attempts: 3 });
	});

	it('gives up immediately on a non-retryable error', async () => {
		let n = 0;
		await expect(
			withRetry(
				async () => {
					n++;
					throw new Error('bad request');
				},
				{ retries: 5, baseDelayMs: 1, isRetryable: () => false, sleep: noSleep }
			)
		).rejects.toMatchObject({ message: 'bad request', attempts: 1 });
		expect(n).toBe(1);
	});
});

describe('runBakeoff', () => {
	it('sends the system prompt, the case and per-model params', async () => {
		const client = fakeClient(async () => ok());
		await runBakeoff(config({ rounds: 1 }), { client, sleep: noSleep });
		const two = client.requests.find((r) => r.model === 'x/two');
		expect(two?.messages).toEqual([
			{ role: 'system', content: 'sys' },
			{ role: 'user', content: 'ua' }
		]);
		expect(two?.params).toEqual({ reasoning: { effort: 'low' } });
		expect(two?.requireParameters).toBe(true);
	});

	it('records usage and the serving provider', async () => {
		const client = fakeClient(async () => ok('{"a":1}', 0.002));
		const [first] = await runBakeoff(config({ rounds: 1 }), { client, sleep: noSleep });
		expect(first).toMatchObject({ status: 'ok', output: '{"a":1}', attempts: 1, usage: { costUsd: 0.002 }, servedBy: { provider: 'P' } });
	});

	it('retries a 429 and succeeds', async () => {
		const client = fakeClient(async (_req, n) => {
			if (n === 1) throw new ApiError('HTTP 429: slow down', 429, true);
			return ok();
		});
		const records = await runBakeoff(config({ rounds: 1, models: [{ id: 'x/one' }], concurrency: 1 }), { client, sleep: noSleep });
		expect(records[0]).toMatchObject({ status: 'ok', attempts: 2 });
	});

	it('records a non-retryable error as a failed call, not a crash', async () => {
		const client = fakeClient(async () => {
			throw new ApiError('HTTP 400: bad model', 400, false);
		});
		const records = await runBakeoff(config({ rounds: 1 }), { client, sleep: noSleep });
		expect(records.every((r) => r.status === 'error' && r.attempts === 1)).toBe(true);
		expect(records[0]?.error).toBe('HTTP 400: bad model');
	});

	it('times out a hung call through the abort signal', async () => {
		const client = fakeClient(
			(req) =>
				new Promise((_resolve, reject) => {
					req.signal?.addEventListener('abort', () => reject(req.signal?.reason));
				})
		);
		const records = await runBakeoff(config({ rounds: 1, models: [{ id: 'x/one' }], timeoutMs: 50, retries: 0 }), {
			client,
			sleep: noSleep
		});
		expect(records[0]?.status).toBe('error');
		expect(records[0]?.error).toMatch(/timeout/i);
	}, 10_000);

	it('stops starting calls once reported spend reaches the budget', async () => {
		const client = fakeClient(async () => ok('{}', 0.6));
		const records = await runBakeoff(config({ concurrency: 1 }), { client, sleep: noSleep });
		expect(records.filter((r) => r.status === 'ok')).toHaveLength(2);
		expect(records.filter((r) => r.status === 'skipped')).toHaveLength(6);
		expect(client.requests).toHaveLength(2);
	});
});
