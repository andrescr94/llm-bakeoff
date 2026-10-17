/** Small concurrency and retry helpers, so the runner has no dependency for either. */

/** Run `fn` over `items` with at most `limit` in flight. Results keep input order. */
export async function mapPool<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < items.length) {
			const index = next++;
			results[index] = await fn(items[index] as T, index);
		}
	};
	await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
	return results;
}

export interface RetryOptions {
	retries: number;
	baseDelayMs: number;
	isRetryable: (error: unknown) => boolean;
	sleep?: (ms: number) => Promise<void>;
}

/**
 * Exponential backoff with full jitter. Returns the value and how many attempts it took,
 * because "succeeded on the third try" is a reliability finding worth reporting.
 */
export async function withRetry<T>(
	fn: (attempt: number) => Promise<T>,
	options: RetryOptions
): Promise<{ value: T; attempts: number }> {
	const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	for (let attempt = 1; ; attempt++) {
		try {
			return { value: await fn(attempt), attempts: attempt };
		} catch (error) {
			if (attempt > options.retries || !options.isRetryable(error)) {
				throw Object.assign(error instanceof Error ? error : new Error(String(error)), { attempts: attempt });
			}
			await sleep(Math.random() * options.baseDelayMs * 2 ** (attempt - 1));
		}
	}
}
