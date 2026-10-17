import type { z } from 'zod';
import type { ScoreContext, Scorer } from '../types.ts';
import { parseJsonOutput } from './json.ts';

/**
 * A task-specific rule over the parsed output.
 *
 * `test` returns `true` to pass, or a string saying what is wrong. It only runs when the
 * output already matches `schema`, so it can rely on the shape: shape errors belong to
 * `matchesSchema`, and reporting them twice would double-count one failure.
 */
export function check<T>(
	name: string,
	schema: z.ZodType<T>,
	test: (value: T, ctx: ScoreContext) => true | string,
	options: { required?: boolean } = {}
): Scorer {
	return {
		name,
		required: options.required ?? true,
		score(ctx) {
			const parsed = parseJsonOutput(ctx.output);
			if (!parsed.ok) return { pass: null, detail: 'not JSON; see matches-schema' };
			const shaped = schema.safeParse(parsed.value);
			if (!shaped.success) return { pass: null, detail: 'wrong shape; see matches-schema' };
			const verdict = test(shaped.data, ctx);
			return verdict === true ? { pass: true } : { pass: false, detail: verdict };
		}
	};
}
