import { describe, expect, it } from 'vitest';
import { ApiError, openRouter, type FetchLike } from '../src/openrouter.ts';

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function capture(response: Response): { fetch: FetchLike; calls: { url: string; init?: RequestInit }[] } {
	const calls: { url: string; init?: RequestInit }[] = [];
	return {
		calls,
		fetch: async (url, init) => {
			calls.push({ url, ...(init ? { init } : {}) });
			return response;
		}
	};
}

const request = { model: 'v/m', messages: [{ role: 'user' as const, content: 'hi' }], maxOutputTokens: 50 };

describe('openRouter client', () => {
	it('reads text, reported cost, cached tokens and the serving provider', async () => {
		const { fetch } = capture(
			json({
				model: 'v/m',
				provider: 'SomeHost',
				choices: [{ message: { content: '{"ok":true}' } }],
				usage: { prompt_tokens: 1800, completion_tokens: 60, cost: 0.000115, prompt_tokens_details: { cached_tokens: 1748 } }
			})
		);
		const result = await openRouter({ apiKey: 'k', fetch }).complete(request);
		expect(result).toEqual({
			text: '{"ok":true}',
			usage: { inputTokens: 1800, outputTokens: 60, cachedTokens: 1748, costUsd: 0.000115 },
			servedBy: { model: 'v/m', provider: 'SomeHost' }
		});
	});

	it('reports missing usage as null, never as zero', async () => {
		const { fetch } = capture(json({ choices: [{ message: { content: 'x' } }] }));
		const result = await openRouter({ apiKey: 'k', fetch }).complete(request);
		expect(result.usage).toEqual({ inputTokens: null, outputTokens: null, cachedTokens: null, costUsd: null });
	});

	it('sends require_parameters, response_format, max_tokens and model params', async () => {
		const { fetch, calls } = capture(json({ choices: [] }));
		await openRouter({ apiKey: 'k', fetch }).complete({
			...request,
			responseFormat: { type: 'json_object' },
			params: { reasoning: { effort: 'low' } }
		});
		const body = JSON.parse(String(calls[0]?.init?.body));
		expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
		expect(body).toMatchObject({
			model: 'v/m',
			max_tokens: 50,
			response_format: { type: 'json_object' },
			provider: { require_parameters: true },
			reasoning: { effort: 'low' }
		});
		expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe('Bearer k');
	});

	it('marks 429 and 5xx retryable and 400 not', async () => {
		const fail = async (status: number) =>
			openRouter({ apiKey: 'k', fetch: capture(json({ error: { message: 'nope' } }, status)).fetch })
				.complete(request)
				.catch((e: ApiError) => e);
		expect(await fail(429)).toMatchObject({ retryable: true, status: 429, message: 'HTTP 429: nope' });
		expect(await fail(503)).toMatchObject({ retryable: true });
		expect(await fail(400)).toMatchObject({ retryable: false });
	});

	it('treats a 200 carrying an upstream error as an error', async () => {
		const { fetch } = capture(json({ error: { code: 502, message: 'provider down' } }));
		await expect(openRouter({ apiKey: 'k', fetch }).complete(request)).rejects.toMatchObject({ retryable: true, status: 502 });
	});

	it('refuses to call without a key', async () => {
		const { fetch, calls } = capture(json({}));
		await expect(openRouter({ fetch }).complete(request)).rejects.toThrow(/OPENROUTER_API_KEY/);
		expect(calls).toHaveLength(0);
	});

	it('reads prices from the public models list without a key', async () => {
		const { fetch } = capture(
			json({ data: [{ id: 'v/m', pricing: { prompt: '0.0000002', completion: '0.0000012' } }, { id: 'v/other', pricing: { prompt: '1', completion: '1' } }] })
		);
		expect(await openRouter({ fetch }).prices(['v/m', 'v/missing'])).toEqual({ 'v/m': { prompt: 2e-7, completion: 1.2e-6 } });
	});
});
