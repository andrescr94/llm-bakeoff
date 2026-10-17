import type { CallRecord, ScoredRecord, ScoreResult, Task } from './types.ts';

/**
 * Run every scorer of the task over one call.
 *
 * A call that never produced text (timeout, HTTP error, skipped by the budget) fails every
 * required scorer with the call's own error as the reason, so it counts against validity
 * exactly once in the "why outputs failed" table, under its real cause.
 */
export function scoreRecord(record: CallRecord, task: Task): ScoredRecord {
	const testCase = task.cases.find((c) => c.id === record.caseId);
	if (!testCase) throw new Error(`Record refers to unknown case "${record.caseId}".`);

	if (record.status !== 'ok' || record.output == null) {
		const reason = record.status === 'skipped' ? 'skipped' : errorReason(record.error);
		const scores: ScoreResult[] = task.scorers.map((s) => ({
			scorer: s.name,
			required: s.required,
			pass: s.required ? false : null,
			reason,
			...(record.error ? { detail: record.error } : {})
		}));
		return { ...record, scores };
	}

	const output = record.output;
	const scores = task.scorers.map((s): ScoreResult => {
		try {
			return { scorer: s.name, required: s.required, ...s.score({ output, record, testCase }) };
		} catch (error) {
			// A scorer that throws is a bug in the scorer, not in the model. Fail loudly in the
			// report instead of crashing a run that already spent money.
			const detail = error instanceof Error ? error.message : String(error);
			return { scorer: s.name, required: s.required, pass: false, reason: 'scorer-crashed', detail };
		}
	});
	return { ...record, scores };
}

export function scoreAll(records: CallRecord[], task: Task): ScoredRecord[] {
	return records.map((r) => scoreRecord(r, task));
}

/** Valid = the call succeeded and every required scorer passed. */
export function isValid(record: ScoredRecord): boolean {
	return record.status === 'ok' && record.scores.every((s) => !s.required || s.pass === true);
}

/** The grouping key for an invalid record: its first failing required check. */
export function failureReason(record: ScoredRecord): string | null {
	if (isValid(record)) return null;
	const first = record.scores.find((s) => s.required && s.pass !== true);
	if (!first) return record.status;
	return first.reason ?? first.scorer;
}

function errorReason(error: string | undefined): string {
	if (!error) return 'call-failed';
	if (/timed? ?out|timeout|aborted/i.test(error)) return 'timeout';
	if (/\b429\b|rate.?limit/i.test(error)) return 'rate-limited';
	return 'call-failed';
}
