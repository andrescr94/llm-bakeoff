import type { Scorer } from '../types.ts';

/**
 * Did this call read its prompt prefix from a cache?
 *
 * Reads `usage.prompt_tokens_details.cached_tokens` as the API reported it. It does not
 * apply (`pass: null`) to round 1, which has nothing to hit yet, or to calls whose usage
 * did not report cached tokens. Caching is model-specific, and some providers write the
 * cache asynchronously, so a miss here is a finding about the model, not necessarily a bug.
 */
export function cacheHit(options: { fromRound?: number; minShare?: number } = {}): Scorer {
	const fromRound = options.fromRound ?? 2;
	const minShare = options.minShare ?? 0.5;
	return {
		name: 'cache-hit',
		required: false,
		score({ record }) {
			const { cachedTokens, inputTokens } = record.usage;
			if (record.round < fromRound || cachedTokens == null || !inputTokens) {
				return { pass: null };
			}
			const share = cachedTokens / inputTokens;
			return share >= minShare
				? { pass: true }
				: { pass: false, detail: `${cachedTokens}/${inputTokens} input tokens cached` };
		}
	};
}
