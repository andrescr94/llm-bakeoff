import type { Summary } from '../aggregate.ts';
import type { ResultsFile } from '../types.ts';

/** Every record plus the computed summary. `--replay` and `--report` read this file back. */
export function renderJson(results: ResultsFile, summary: Summary): string {
	return JSON.stringify({ ...results, summary }, null, '\t');
}
