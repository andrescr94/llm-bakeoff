import type { z } from 'zod';
import type { Scorer } from '../types.ts';
import { parseJsonOutput } from './json.ts';

/**
 * The output must be JSON that matches a zod schema. The first issue is reported with its
 * path, so a failure reads as "fields.2.options: expected array", not "invalid".
 */
export function matchesSchema(
	schema: z.ZodType,
	options: { name?: string; required?: boolean } = {}
): Scorer {
	return {
		name: options.name ?? 'matches-schema',
		required: options.required ?? true,
		score({ output }) {
			const parsed = parseJsonOutput(output);
			if (!parsed.ok) return { pass: false, reason: 'not-json', detail: parsed.error };
			const result = schema.safeParse(parsed.value);
			if (result.success) return { pass: true };
			const issue = result.error.issues[0];
			const path = issue?.path.length ? issue.path.join('.') : '(root)';
			return { pass: false, detail: `${path}: ${issue?.message ?? 'invalid'}` };
		}
	};
}
