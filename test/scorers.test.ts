import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { cacheHit, check, latencyUnder, matchesSchema, parseJsonOutput } from '../src/scorers/index.ts';
import type { ScoreContext } from '../src/types.ts';
import { call } from './helpers.ts';

const ctx = (output: string, overrides = {}): ScoreContext => ({
	output,
	record: call({ output, ...overrides }),
	testCase: { id: 'c1', user: 'brief' }
});

describe('parseJsonOutput', () => {
	it('parses plain JSON', () => {
		expect(parseJsonOutput(' {"a":1} ')).toEqual({ ok: true, value: { a: 1 } });
	});
	it('unwraps a fenced json block', () => {
		expect(parseJsonOutput('```json\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } });
	});
	it('rejects prose around JSON', () => {
		expect(parseJsonOutput('Here you go: {"a":1}').ok).toBe(false);
	});
});

describe('matchesSchema', () => {
	const scorer = matchesSchema(z.object({ title: z.string(), n: z.number() }), { name: 'schema' });

	it('passes a matching object', () => {
		expect(scorer.score(ctx('{"title":"x","n":1}'))).toEqual({ pass: true });
	});
	it('reports the path of the first issue', () => {
		const result = scorer.score(ctx('{"title":"x","n":"one"}'));
		expect(result.pass).toBe(false);
		expect(result.detail).toMatch(/^n: /);
	});
	it('fails non-JSON with reason not-json', () => {
		expect(scorer.score(ctx('{"title":'))).toMatchObject({ pass: false, reason: 'not-json' });
	});
	it('is required by default', () => {
		expect(scorer.required).toBe(true);
	});
});

describe('check', () => {
	const Shape = z.object({ items: z.array(z.number()) });
	const nonEmpty = check('non-empty', Shape, (v) => v.items.length > 0 || 'no items');

	it('passes when the test returns true', () => {
		expect(nonEmpty.score(ctx('{"items":[1]}'))).toEqual({ pass: true });
	});
	it('fails with the returned message', () => {
		expect(nonEmpty.score(ctx('{"items":[]}'))).toEqual({ pass: false, detail: 'no items' });
	});
	it('does not apply when the shape is wrong, so one failure is not counted twice', () => {
		expect(nonEmpty.score(ctx('{"items":"x"}')).pass).toBeNull();
		expect(nonEmpty.score(ctx('nope')).pass).toBeNull();
	});
	it('can see the test case', () => {
		const echo = check('mentions', Shape, (_v, c) => c.testCase.user === 'brief' || 'wrong case');
		expect(echo.score(ctx('{"items":[]}')).pass).toBe(true);
	});
});

describe('latencyUnder', () => {
	it('is informational by default and compares wall time', () => {
		const scorer = latencyUnder(2000);
		expect(scorer.required).toBe(false);
		expect(scorer.score(ctx('{}', { latencyMs: 1999 })).pass).toBe(true);
		expect(scorer.score(ctx('{}', { latencyMs: 2500 }))).toEqual({ pass: false, detail: '2.5s' });
	});
});

describe('cacheHit', () => {
	const scorer = cacheHit();
	const usage = (cachedTokens: number | null, inputTokens: number | null) => ({
		inputTokens,
		outputTokens: 10,
		cachedTokens,
		costUsd: 0.001
	});

	it('does not apply to round 1', () => {
		expect(scorer.score(ctx('{}', { round: 1, usage: usage(900, 1000) })).pass).toBeNull();
	});
	it('does not apply when cached tokens were not reported', () => {
		expect(scorer.score(ctx('{}', { round: 2, usage: usage(null, 1000) })).pass).toBeNull();
	});
	it('passes when most of the prompt came from cache', () => {
		expect(scorer.score(ctx('{}', { round: 2, usage: usage(900, 1000) })).pass).toBe(true);
	});
	it('fails a miss with the token counts', () => {
		expect(scorer.score(ctx('{}', { round: 2, usage: usage(0, 1000) }))).toEqual({
			pass: false,
			detail: '0/1000 input tokens cached'
		});
	});
});
