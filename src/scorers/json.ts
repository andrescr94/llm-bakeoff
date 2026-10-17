/**
 * Read a model's text as JSON.
 *
 * One concession to reality: a fenced ```json block is unwrapped, because many models add
 * one even when told not to and it says nothing about the quality of the JSON inside.
 * Anything else that is not JSON is a failure, and the scorer says so.
 */
export type ParsedJson = { ok: true; value: unknown } | { ok: false; error: string };

const FENCE = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/;

export function parseJsonOutput(text: string): ParsedJson {
	const trimmed = text.trim();
	const body = FENCE.exec(trimmed)?.[1] ?? trimmed;
	try {
		return { ok: true, value: JSON.parse(body) };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}
