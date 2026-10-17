import { describe, expect, it } from 'vitest';
import { task } from '../examples/intake-form/task.ts';
import { scoreRecord, isValid, failureReason } from '../src/score.ts';
import { call } from './helpers.ts';

const field = (over: Record<string, unknown> = {}) => ({
	key: 'goal',
	label: 'Goal',
	type: 'long_text',
	required: true,
	help: 'What you want.',
	options: [],
	...over
});

const form = (fields: unknown[], title = 'A form') => JSON.stringify({ title, fields });
const four = (first: Record<string, unknown> = {}) => [
	field(first),
	field({ key: 'b' }),
	field({ key: 'c' }),
	field({ key: 'd', type: 'single_choice', options: ['Yes', 'No'] })
];
const score = (output: string, caseId = 'pottery-feedback') => scoreRecord(call({ output, caseId }), task);

describe('intake-form task', () => {
	it('accepts a well-formed form', () => {
		const r = score(form(four()));
		expect(isValid(r)).toBe(true);
	});

	it('rejects options on a long_text field: the failure mode from the case study', () => {
		const r = score(form(four({ options: ['a', 'b'] })));
		expect(isValid(r)).toBe(false);
		expect(failureReason(r)).toBe('options-only-on-choice');
		expect(r.scores.find((s) => s.scorer === 'options-only-on-choice')?.detail).toBe(
			'goal is long_text but carries 2 options'
		);
	});

	it('rejects a choice field with fewer than two options', () => {
		const r = score(form(four({ type: 'single_choice', options: ['only'] })));
		expect(failureReason(r)).toBe('choices-have-options');
	});

	it('rejects an empty title, an empty key, a duplicate key and too few fields', () => {
		expect(failureReason(score(form(four(), '  ')))).toBe('has-title');
		expect(failureReason(score(form(four({ key: '' }))))).toBe('usable-keys');
		expect(failureReason(score(form(four({ key: 'b' }))))).toBe('usable-keys');
		expect(failureReason(score(form(four().slice(0, 3))))).toBe('4-10-fields');
	});

	it('flags unasked-for contact fields without failing the output', () => {
		const fields = [...four(), field({ key: 'contact_email', type: 'email' })];
		const r = score(form(fields), 'beta-bugs');
		expect(isValid(r)).toBe(true);
		expect(r.scores.find((s) => s.scorer === 'no-unasked-contact')?.pass).toBe(false);
		expect(score(form(fields), 'beach-cleanup').scores.find((s) => s.scorer === 'no-unasked-contact')?.pass).toBe(true);
	});

	it('v2 is v1 plus exactly one paragraph', () => {
		const [v1, v2] = task.variants;
		expect(v2?.system.length).toBeGreaterThan(v1?.system.length ?? 0);
		const v1Paragraphs = (v1?.system ?? '').split('\n\n');
		const v2Paragraphs = (v2?.system ?? '').split('\n\n');
		expect(v2Paragraphs.length - v1Paragraphs.length).toBe(1);
		expect(v2Paragraphs.filter((p) => !v1Paragraphs.includes(p))).toHaveLength(1);
	});
});
