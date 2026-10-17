import type { Scorer } from '../types.ts';

/** Was the answer fast enough for the person waiting on it? Informational by default. */
export function latencyUnder(ms: number, options: { required?: boolean } = {}): Scorer {
	return {
		name: `latency<${ms / 1000}s`,
		required: options.required ?? false,
		score({ record }) {
			return record.latencyMs < ms
				? { pass: true }
				: { pass: false, detail: `${(record.latencyMs / 1000).toFixed(1)}s` };
		}
	};
}
