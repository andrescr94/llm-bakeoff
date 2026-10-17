import { describe, expect, it } from 'vitest';
import { failureReason, isValid, scoreRecord } from '../src/score.ts';
import type { Task } from '../src/types.ts';
import { call } from './helpers.ts';

const task: Task = {
	id: 't',
	description: '',
	variants: [{ id: 'v1', system: 's' }],
	cases: [{ id: 'c1', user: 'u' }],
	scorers: [
		{ name: 'is-json', required: true, score: ({ output }) => ({ pass: output.startsWith('{') }) },
		{ name: 'fyi', required: false, score: () => ({ pass: true }) },
		{
			name: 'crashy',
			required: false,
			score: () => {
				throw new Error('bug in scorer');
			}
		}
	]
};

describe('scoreRecord', () => {
	it('runs every scorer', () => {
		const r = scoreRecord(call({ output: '{}' }), task);
		expect(r.scores.map((s) => [s.scorer, s.pass])).toEqual([
			['is-json', true],
			['fyi', true],
			['crashy', false]
		]);
	});

	it('turns a crashing scorer into a failed score instead of crashing the run', () => {
		const r = scoreRecord(call({ output: '{}' }), task);
		expect(r.scores[2]).toMatchObject({ reason: 'scorer-crashed', detail: 'bug in scorer' });
		// It is not required, so the output is still valid.
		expect(isValid(r)).toBe(true);
	});

	it('fails required scorers of a timed-out call with reason "timeout", once', () => {
		const r = scoreRecord(
			call({ status: 'error', output: null, error: 'The operation was aborted due to timeout' }),
			task
		);
		expect(isValid(r)).toBe(false);
		expect(failureReason(r)).toBe('timeout');
		expect(r.scores.filter((s) => s.pass === false)).toHaveLength(1);
	});

	it('names rate limits and skipped calls', () => {
		expect(failureReason(scoreRecord(call({ status: 'error', output: null, error: 'HTTP 429: slow down' }), task))).toBe('rate-limited');
		expect(failureReason(scoreRecord(call({ status: 'skipped', output: null }), task))).toBe('skipped');
	});

	it('refuses a record for a case the task does not have', () => {
		expect(() => scoreRecord(call({ caseId: 'nope' }), task)).toThrow(/unknown case/);
	});
});
