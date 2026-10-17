/**
 * Builds `examples/intake-form/recorded/demo-run.json`: the file `npm run demo` replays.
 *
 * THIS IS AN ILLUSTRATIVE FIXTURE, NOT A MEASUREMENT. The model ids are fictional
 * (`demo/...`), and latency, tokens and cost are drawn from a seeded generator. What is
 * real is the pipeline it feeds: the outputs are actual JSON text, and `npm run demo`
 * scores them with the same scorers a live run uses, so the report is computed, not typed.
 *
 * The failure plan below is chosen to show the failure mode this repo is about: models
 * attaching `options` to free-text fields under the baseline prompt, and far fewer doing
 * it once the prompt says not to. For real numbers see `case-study/`.
 *
 *   npm run fixture        # rewrite the file; a test checks the committed copy matches
 */
import { fileURLToPath } from 'node:url';
import { cases, task, type IntakeForm } from '../examples/intake-form/task.ts';
import { writeText } from '../src/results-file.ts';
import { planJobs } from '../src/runner.ts';
import { scoreAll } from '../src/score.ts';
import type { BakeoffConfig, CallRecord, ResultsFile } from '../src/types.ts';

export const FIXTURE_PATH = fileURLToPath(
	new URL('../examples/intake-form/recorded/demo-run.json', import.meta.url)
);

type Mutation = 'options-on-text' | 'empty-key' | 'no-title' | 'truncated' | 'timeout' | 'contact' | 'fenced';

interface Profile {
	id: string;
	latencyS: [number, number];
	outputTokens: [number, number];
	/** Fictional USD per token. */
	price: { prompt: number; completion: number };
	cache: 'automatic' | 'lagged' | 'none';
}

const PROFILES: Profile[] = [
	{ id: 'demo/fast-json', latencyS: [7, 14], outputTokens: [600, 900], price: { prompt: 2e-7, completion: 1.2e-6 }, cache: 'automatic' },
	{ id: 'demo/slow-thinker', latencyS: [50, 190], outputTokens: [3500, 6000], price: { prompt: 1.5e-7, completion: 4.7e-7 }, cache: 'automatic' },
	{ id: 'demo/cheap-flash', latencyS: [11, 42], outputTokens: [700, 1400], price: { prompt: 1e-8, completion: 1.2e-6 }, cache: 'lagged' },
	{ id: 'demo/cheapest-chat', latencyS: [15, 30], outputTokens: [1200, 2400], price: { prompt: 2e-8, completion: 2e-7 }, cache: 'none' }
];

/** `model|variant|case|round` → what goes wrong with that call. */
const PLAN: Record<string, Mutation[]> = {
	'demo/slow-thinker|v1-baseline|pottery-feedback|1': ['options-on-text'],
	'demo/slow-thinker|v1-baseline|pottery-feedback|2': ['options-on-text'],
	'demo/slow-thinker|v1-baseline|dog-walking|1': ['timeout'],
	'demo/cheap-flash|v1-baseline|beta-bugs|1': ['options-on-text', 'contact'],
	'demo/cheap-flash|v1-baseline|beta-bugs|2': ['options-on-text'],
	'demo/cheap-flash|v1-baseline|beach-cleanup|2': ['options-on-text'],
	'demo/cheap-flash|v1-baseline|vague|1': ['truncated'],
	'demo/cheapest-chat|v1-baseline|pottery-feedback|1': ['options-on-text', 'fenced'],
	'demo/cheapest-chat|v1-baseline|beach-cleanup|1': ['options-on-text'],
	'demo/cheapest-chat|v1-baseline|beach-cleanup|2': ['options-on-text'],
	'demo/cheapest-chat|v1-baseline|vague|1': ['no-title'],
	'demo/cheapest-chat|v1-baseline|vague|2': ['no-title'],
	'demo/cheapest-chat|v1-baseline|dog-walking|2': ['fenced'],
	'demo/slow-thinker|v2-options-rule|dog-walking|2': ['timeout'],
	'demo/cheap-flash|v2-options-rule|beta-bugs|1': ['contact'],
	'demo/cheap-flash|v2-options-rule|beach-cleanup|1': ['empty-key'],
	'demo/cheapest-chat|v2-options-rule|vague|1': ['no-title'],
	'demo/cheapest-chat|v2-options-rule|vague|2': ['no-title'],
	'demo/cheapest-chat|v2-options-rule|pottery-feedback|2': ['fenced']
};

const f = (key: string, label: string, type: IntakeForm['fields'][number]['type'], required: boolean, help: string, options: string[] = []) => ({ key, label, type, required, help, options });

/** One well-formed answer per brief. Mutations are applied on top. */
const GOOD: Record<string, IntakeForm> = {
	'dog-walking': {
		title: 'New dog-walking client',
		fields: [
			f('dog_name', 'Dog name', 'text', true, 'The name your dog answers to.'),
			f('dog_size', 'Dog size', 'single_choice', true, 'Pick the closest; it decides how many dogs share a walk.', ['Small', 'Medium', 'Large']),
			f('walk_days', 'Walk days', 'multi_choice', true, 'Every day you want a walk, even if it changes week to week.', ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']),
			f('start_date', 'Start date', 'date', false, 'The first day you would like a walk.'),
			f('behaviour_notes', 'Behaviour notes', 'long_text', false, 'Anything a new walker should know, such as pulling, other dogs or fear of bikes.'),
			f('anything_else', 'Anything else', 'long_text', false, 'Keys, gate codes or routines we should know about.')
		]
	},
	'pottery-feedback': {
		title: 'Pottery workshop feedback',
		fields: [
			f('overall_rating', 'Overall rating', 'scale', true, 'One is poor, five is excellent.'),
			f('best_part', 'Best part', 'long_text', false, 'The moment or technique you enjoyed most, for example throwing on the wheel.'),
			f('improve', 'What to improve', 'long_text', true, 'One concrete change that would have made the weekend better.'),
			f('come_again', 'Would come again', 'single_choice', true, 'Be honest; it helps us plan the next one.', ['Yes', 'Maybe', 'No']),
			f('anything_else', 'Anything else', 'long_text', false, 'Anything you would like the teacher to hear.')
		]
	},
	'beta-bugs': {
		title: 'Beta bug report',
		fields: [
			f('what_broke', 'What broke', 'long_text', true, 'What you expected to happen and what happened instead.'),
			f('screen', 'Where it happened', 'text', true, 'The screen or feature name, for example "checkout".'),
			f('severity', 'Severity', 'single_choice', true, 'How much it stops you using the app.', ['Blocks me', 'Annoying', 'Cosmetic']),
			f('steps_to_reproduce', 'Steps to reproduce', 'long_text', false, 'The taps that lead to it, one per line, if you can repeat it.'),
			f('device', 'Device and OS', 'text', false, 'For example "Pixel 9, Android 16".'),
			f('anything_else', 'Anything else', 'long_text', false, 'Screenshots or anything that might help.')
		]
	},
	'beach-cleanup': {
		title: 'Beach clean-up volunteers',
		fields: [
			f('full_name', 'Full name', 'text', true, 'So we can check you in on the day.'),
			f('email', 'Email', 'email', true, 'We send the meeting point and any weather changes here.'),
			f('group_size', 'Group size', 'number', true, 'Count yourself and anyone coming with you.'),
			f('shift', 'Shift', 'single_choice', true, 'Pick the time you can stay for.', ['Morning', 'Afternoon', 'Both']),
			f('bring_gloves', 'Bringing gloves', 'single_choice', false, 'We have spares, but not many.', ['Yes', 'No'])
		]
	},
	vague: {
		title: 'What do you need help with',
		fields: [
			f('goal', 'Your goal', 'long_text', true, 'What you are trying to get done, in a sentence or two.'),
			f('deadline', 'Deadline', 'date', false, 'When it needs to be done, if there is a date.'),
			f('tried_so_far', 'Tried so far', 'long_text', false, 'Anything you have already tried, so we do not repeat it.'),
			f('priority', 'Priority', 'single_choice', true, 'How soon this matters.', ['This week', 'This month', 'No rush'])
		]
	}
};

/** mulberry32: small, seeded, deterministic. */
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function hash(text: string): number {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
	return h >>> 0;
}

const between = (r: () => number, [lo, hi]: [number, number]) => lo + (hi - lo) * r();

function mutate(form: IntakeForm, mutations: Mutation[]): string {
	const out: IntakeForm = structuredClone(form);
	for (const m of mutations) {
		if (m === 'options-on-text') {
			const field = out.fields.find((x) => x.type === 'long_text' || x.type === 'text');
			if (field) field.options = ['For example…', 'Something else', 'Not sure yet'];
		}
		if (m === 'empty-key' && out.fields[1]) out.fields[1].key = '';
		if (m === 'no-title') out.title = '';
		if (m === 'contact') out.fields.push(f('contact_email', 'Email', 'email', false, 'In case we need to follow up.'));
	}
	let text = JSON.stringify(out, null, 2);
	if (mutations.includes('truncated')) text = text.slice(0, Math.floor(text.length * 0.6));
	if (mutations.includes('fenced')) text = `\`\`\`json\n${text}\n\`\`\``;
	return text;
}

export function buildFixture(): ResultsFile {
	const config = {
		name: 'intake-form (demo)',
		task,
		models: PROFILES.map((p) => ({ id: p.id })),
		rounds: 2,
		maxOutputTokens: 6000,
		concurrency: 4,
		timeoutMs: 240_000,
		retries: 1,
		budgetUsd: 1
	} satisfies BakeoffConfig;

	const systemTokens = new Map(task.variants.map((v) => [v.id, Math.round(v.system.length / 4.2)]));
	const seen = new Set<string>();

	const records: CallRecord[] = planJobs(config).map((job) => {
		const profile = PROFILES.find((p) => p.id === job.model) as Profile;
		const key = `${job.model}|${job.variant}|${job.caseId}|${job.round}`;
		const r = rng(hash(key));
		const mutations = PLAN[key] ?? [];
		const testCase = cases.find((c) => c.id === job.caseId);
		const inputTokens = (systemTokens.get(job.variant) ?? 0) + Math.round((testCase?.user.length ?? 0) / 4) + 8;

		if (mutations.includes('timeout')) {
			return {
				...job,
				status: 'error',
				error: 'The operation was aborted due to timeout',
				attempts: 2,
				latencyMs: 240_000,
				output: null,
				usage: { inputTokens: null, outputTokens: null, cachedTokens: null, costUsd: null }
			};
		}

		const prefix = `${job.model}|${job.variant}`;
		const warm = seen.has(prefix);
		seen.add(prefix);
		const hits =
			profile.cache === 'automatic' ? warm : profile.cache === 'lagged' ? job.round > 1 : false;
		const cachedTokens = hits ? Math.floor((inputTokens - 40) / 128) * 128 : 0;
		const outputTokens = Math.round(between(r, profile.outputTokens));
		const costUsd =
			(inputTokens - cachedTokens) * profile.price.prompt +
			cachedTokens * profile.price.prompt * 0.1 +
			outputTokens * profile.price.completion;

		return {
			...job,
			status: 'ok',
			attempts: 1,
			latencyMs: Math.round(between(r, profile.latencyS) * 1000),
			output: mutate(GOOD[job.caseId] as IntakeForm, mutations),
			usage: { inputTokens, outputTokens, cachedTokens, costUsd: Number(costUsd.toFixed(7)) },
			servedBy: { model: job.model, provider: 'Demo' }
		};
	});

	return {
		schemaVersion: 1,
		name: config.name,
		task: task.id,
		provenance: 'illustrative-fixture',
		note: 'Fictional models; outputs, timings and costs made by scripts/make-demo-fixture.ts. Scores are computed from the outputs by the real scorers.',
		createdAt: '2026-10-16T00:00:00.000Z',
		budgetUsd: config.budgetUsd,
		plan: {
			models: config.models.map((m) => m.id),
			variants: task.variants.map((v) => v.id),
			cases: cases.map((c) => c.id),
			rounds: config.rounds
		},
		records: scoreAll(records, task)
	};
}

export function fixtureJson(): string {
	return `${JSON.stringify(buildFixture(), null, '\t')}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	await writeText(FIXTURE_PATH, fixtureJson());
	console.log(`wrote ${FIXTURE_PATH}`);
}
