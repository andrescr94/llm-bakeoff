/**
 * The one place that talks to a model API.
 *
 * OpenRouter is OpenAI-compatible, so this is a plain `fetch` to `/chat/completions` rather
 * than an SDK: the fields this harness exists to read (`usage.cost`, `cached_tokens`, the
 * serving `provider`) are OpenRouter's own, and reading them from untyped JSON through one
 * zod schema is clearer than casting an SDK's types in several places.
 *
 * `fetch` is injected, so tests hand in a fake and nothing here needs a key or a network.
 */
import { z } from 'zod';
import type { Price, Usage } from './types.ts';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface CompletionRequest {
	model: string;
	messages: ChatMessage[];
	maxOutputTokens: number;
	temperature?: number;
	responseFormat?: { type: 'json_object' };
	requireParameters?: boolean;
	params?: Record<string, unknown>;
	signal?: AbortSignal;
}

export interface Completion {
	text: string;
	usage: Usage;
	servedBy: { model?: string; provider?: string };
}

/** An HTTP or API error, carrying enough to decide whether a retry can help. */
export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number | null,
		readonly retryable: boolean
	) {
		super(message);
		this.name = 'ApiError';
	}
}

const UsageJson = z
	.object({
		prompt_tokens: z.number().optional(),
		completion_tokens: z.number().optional(),
		cost: z.number().optional(),
		prompt_tokens_details: z.object({ cached_tokens: z.number().optional() }).nullish()
	})
	.nullish();

const CompletionJson = z.object({
	model: z.string().optional(),
	provider: z.string().optional(),
	choices: z
		.array(z.object({ message: z.object({ content: z.string().nullish() }).optional() }))
		.optional(),
	usage: UsageJson,
	error: z.object({ code: z.union([z.number(), z.string()]).optional(), message: z.string() }).optional()
});

export function isRetryableStatus(status: number): boolean {
	return status === 408 || status === 429 || status >= 500;
}

export interface OpenRouterClient {
	complete(request: CompletionRequest): Promise<Completion>;
	prices(modelIds: string[]): Promise<Record<string, Price>>;
}

export function openRouter(options: {
	apiKey?: string;
	fetch?: FetchLike;
	baseUrl?: string;
}): OpenRouterClient {
	const doFetch = options.fetch ?? fetch;
	const baseUrl = options.baseUrl ?? OPENROUTER_BASE_URL;

	return {
		async complete(request) {
			if (!options.apiKey) {
				throw new ApiError('OPENROUTER_API_KEY is not set; a live run needs it.', null, false);
			}
			const body = {
				model: request.model,
				messages: request.messages,
				max_tokens: request.maxOutputTokens,
				...(request.temperature === undefined ? {} : { temperature: request.temperature }),
				...(request.responseFormat ? { response_format: request.responseFormat } : {}),
				provider: { require_parameters: request.requireParameters ?? true },
				...request.params
			};
			const response = await doFetch(`${baseUrl}/chat/completions`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${options.apiKey}`,
					'Content-Type': 'application/json',
					'X-Title': 'llm-bakeoff'
				},
				body: JSON.stringify(body),
				...(request.signal ? { signal: request.signal } : {})
			});

			const raw: unknown = await response.json().catch(() => null);
			if (!response.ok) {
				const message = CompletionJson.safeParse(raw).data?.error?.message ?? response.statusText;
				throw new ApiError(
					`HTTP ${response.status}: ${message}`,
					response.status,
					isRetryableStatus(response.status)
				);
			}

			const parsed = CompletionJson.safeParse(raw);
			if (!parsed.success) throw new ApiError('Response was not a chat completion.', 200, false);
			const json = parsed.data;
			// OpenRouter can answer 200 with an error body when the upstream provider fails.
			if (json.error) {
				const code = Number(json.error.code);
				throw new ApiError(
					`Upstream error ${json.error.code ?? ''}: ${json.error.message}`.trim(),
					Number.isFinite(code) ? code : null,
					Number.isFinite(code) ? isRetryableStatus(code) : true
				);
			}

			return {
				text: json.choices?.[0]?.message?.content ?? '',
				usage: {
					inputTokens: json.usage?.prompt_tokens ?? null,
					outputTokens: json.usage?.completion_tokens ?? null,
					cachedTokens: json.usage?.prompt_tokens_details?.cached_tokens ?? null,
					costUsd: json.usage?.cost ?? null
				},
				servedBy: {
					...(json.model ? { model: json.model } : {}),
					...(json.provider ? { provider: json.provider } : {})
				}
			};
		},

		/** Public endpoint, no key needed. Prices are strings of USD per token. */
		async prices(modelIds) {
			const response = await doFetch(`${baseUrl}/models`);
			if (!response.ok) {
				throw new ApiError(`Could not read model prices: HTTP ${response.status}`, response.status, true);
			}
			const ModelsJson = z.object({
				data: z.array(
					z.object({
						id: z.string(),
						pricing: z.object({ prompt: z.string(), completion: z.string() })
					})
				)
			});
			const { data } = ModelsJson.parse(await response.json());
			const out: Record<string, Price> = {};
			for (const id of modelIds) {
				const model = data.find((m) => m.id === id);
				if (model) {
					out[id] = { prompt: Number(model.pricing.prompt), completion: Number(model.pricing.completion) };
				}
			}
			return out;
		}
	};
}
