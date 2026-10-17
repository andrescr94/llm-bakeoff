/**
 * Example task: turn a one-line brief into a short intake form, as JSON.
 *
 * It is small on purpose and it reproduces one real failure mode. The validator below
 * rejects `options` on any field that is not a choice type, and the baseline prompt never
 * says so. Models that helpfully attach suggestion lists to a `long_text` field get the
 * whole output rejected. The second prompt variant adds one paragraph saying it, which is
 * the whole difference between the two.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { cacheHit, check, latencyUnder, matchesSchema } from '../../src/scorers/index.ts';
import type { Task, TaskCase } from '../../src/types.ts';

export const CHOICE_TYPES = ['single_choice', 'multi_choice'] as const;

export const FieldType = z.enum([
	'text',
	'long_text',
	'email',
	'number',
	'date',
	'single_choice',
	'multi_choice',
	'scale'
]);

export const Field = z.object({
	key: z.string(),
	label: z.string(),
	type: FieldType,
	required: z.boolean(),
	help: z.string(),
	options: z.array(z.string())
});

export const IntakeForm = z.object({
	title: z.string(),
	fields: z.array(Field)
});

export type IntakeForm = z.infer<typeof IntakeForm>;

const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const CONTACT_WORDS = /\b(contact|email|e-mail|phone|reach|call (?:them|back)|follow up|sign[- ]?up)\b/i;

const read = (name: string) => readFileSync(new URL(`./prompts/${name}`, import.meta.url), 'utf8').trim();

const baseline = read('v1-baseline.md');
const optionsRule = read('options-rule.md');
const ANCHOR = 'Avoid an "Other" option unless the list genuinely cannot be complete.';
if (!baseline.includes(ANCHOR)) throw new Error('v1-baseline.md lost the paragraph the options rule follows.');

/** v2 is v1 with exactly one paragraph added, so the comparison isolates that paragraph. */
const withOptionsRule = baseline.replace(ANCHOR, `${ANCHOR}\n\n${optionsRule}`);

export const cases: TaskCase[] = [
	{ id: 'dog-walking', user: 'Onboarding questions for a new dog-walking client.' },
	{ id: 'pottery-feedback', user: 'Feedback after a weekend pottery workshop.' },
	{ id: 'beta-bugs', user: 'Bug reports from beta testers of our mobile app: what broke, where, and how bad.' },
	{ id: 'beach-cleanup', user: 'Volunteer sign-up for a Saturday beach clean-up.' },
	// Deliberately almost empty, to see what a model does with nothing to go on.
	{ id: 'vague', user: 'help' }
];

export const task: Task = {
	id: 'intake-form',
	description: 'Generate a short intake form as JSON from a one-line brief.',
	variants: [
		{ id: 'v1-baseline', system: baseline },
		{ id: 'v2-options-rule', system: withOptionsRule }
	],
	cases,
	responseFormat: { type: 'json_object' },
	scorers: [
		matchesSchema(IntakeForm, { name: 'schema' }),
		check('has-title', IntakeForm, (f) => f.title.trim().length > 0 || 'title is empty'),
		check('4-10-fields', IntakeForm, (f) =>
			f.fields.length >= 4 && f.fields.length <= 10 ? true : `${f.fields.length} fields`
		),
		check('usable-keys', IntakeForm, (f) => {
			const bad = f.fields.find((x) => !KEY.test(x.key));
			if (bad) return `key ${JSON.stringify(bad.key)} is not snake_case`;
			const keys = f.fields.map((x) => x.key);
			const dup = keys.find((k, i) => keys.indexOf(k) !== i);
			return dup ? `key "${dup}" appears twice` : true;
		}),
		check('options-only-on-choice', IntakeForm, (f) => {
			const bad = f.fields.find(
				(x) => !(CHOICE_TYPES as readonly string[]).includes(x.type) && x.options.length > 0
			);
			return bad ? `${bad.key} is ${bad.type} but carries ${bad.options.length} options` : true;
		}),
		check('choices-have-options', IntakeForm, (f) => {
			const bad = f.fields.find(
				(x) => (CHOICE_TYPES as readonly string[]).includes(x.type) && x.options.length < 2
			);
			return bad ? `${bad.key} is ${bad.type} with ${bad.options.length} options` : true;
		}),
		// Reported, not gating: a quality signal a person should look at.
		check(
			'no-unasked-contact',
			IntakeForm,
			(f, { testCase }) => {
				if (CONTACT_WORDS.test(testCase.user)) return true;
				const contact = f.fields.find((x) => x.type === 'email' || /phone|email/.test(x.key));
				return contact ? `asks for ${contact.key}, which the brief never mentioned` : true;
			},
			{ required: false }
		),
		latencyUnder(30_000),
		cacheHit()
	]
};
