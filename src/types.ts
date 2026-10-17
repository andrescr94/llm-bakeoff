/**
 * The shared vocabulary. Everything else in `src/` is a function over these types:
 *
 *   config ──► runner ──► CallRecord ──► scorers ──► ScoredRecord ──► aggregate ──► reporters
 */

/** One model to put in the bake-off, by its OpenRouter id. */
export interface ModelSpec {
	/** The OpenRouter id, exactly as `GET /api/v1/models` lists it. */
	id: string;
	/**
	 * Extra request-body fields for this model only, e.g. `{ reasoning: { effort: 'low' } }`.
	 * Merged last, so they win over the defaults.
	 */
	params?: Record<string, unknown>;
}

/** A system prompt under test. Two variants of the same task is how you measure a prompt change. */
export interface PromptVariant {
	id: string;
	system: string;
}

/** One input the task is run on. */
export interface TaskCase {
	id: string;
	/** The user message sent after the system prompt. */
	user: string;
}

/** What a scorer sees: the raw text, the call around it and the case that produced it. */
export interface ScoreContext {
	output: string;
	record: CallRecord;
	testCase: TaskCase;
}

/**
 * `pass: null` means "does not apply to this call" (for example a cache check on the
 * first call of a model, which cannot hit a cache that does not exist yet).
 */
export interface ScoreResult {
	scorer: string;
	/** A required scorer that fails makes the output invalid. Optional ones are reported only. */
	required: boolean;
	pass: boolean | null;
	/** Short grouping key for the "why outputs failed" table. Defaults to the scorer name. */
	reason?: string;
	/** Human-readable explanation of a failure. */
	detail?: string;
}

/** A scorer is a pure function from one output to one verdict. */
export interface Scorer {
	name: string;
	required: boolean;
	score(ctx: ScoreContext): Omit<ScoreResult, 'scorer' | 'required'>;
}

export interface Task {
	id: string;
	description: string;
	variants: PromptVariant[];
	cases: TaskCase[];
	scorers: Scorer[];
	/** Sent as OpenRouter's `response_format`. Omit for free text. */
	responseFormat?: { type: 'json_object' };
}

/** USD per token, the unit OpenRouter's `/models` endpoint uses. */
export interface Price {
	prompt: number;
	completion: number;
}

export interface BakeoffConfig {
	name: string;
	task: Task;
	models: ModelSpec[];
	/** How many times every (model, variant, case) is run. One pass proves little; see README. */
	rounds: number;
	maxOutputTokens: number;
	temperature?: number;
	/** Calls in flight at once, across all models. */
	concurrency: number;
	/** Per attempt, in milliseconds. */
	timeoutMs: number;
	/** Extra attempts after a retryable failure (timeout, network, 429, 5xx). */
	retries: number;
	/** The run refuses to start if its worst-case cost is above this, and stops scheduling at it. */
	budgetUsd: number;
	/**
	 * Route only to upstream providers that support every parameter sent. Without it a
	 * provider that ignores `response_format` still answers, with prose. Default true.
	 */
	requireParameters?: boolean;
	/** Price overrides, USD per token. Anything not listed is read from OpenRouter's `/models`. */
	pricing?: Record<string, Price>;
}

/** Token and money accounting for one call, as the API reported it. `null` = not reported. */
export interface Usage {
	inputTokens: number | null;
	outputTokens: number | null;
	/** `usage.prompt_tokens_details.cached_tokens`: input tokens read from a prompt cache. */
	cachedTokens: number | null;
	/** `usage.cost`: what OpenRouter actually charged, in USD. Never computed from a price table. */
	costUsd: number | null;
}

/** One call, before scoring. */
export interface CallRecord {
	model: string;
	variant: string;
	caseId: string;
	round: number;
	status: 'ok' | 'error' | 'skipped';
	error?: string;
	attempts: number;
	/** Wall time of the final attempt, in milliseconds. */
	latencyMs: number;
	output: string | null;
	usage: Usage;
	/** The model and upstream provider that actually answered, when reported. */
	servedBy?: { model?: string; provider?: string };
}

export interface ScoredRecord extends CallRecord {
	scores: ScoreResult[];
}

/** What `results.json` holds, and what `--replay` and `--report` read back. */
export interface ResultsFile {
	schemaVersion: 1;
	name: string;
	task: string;
	/**
	 * Where these records came from. A reader must never mistake one for the other,
	 * so every reporter prints it.
	 */
	provenance: 'live-run' | 'recorded-run' | 'illustrative-fixture';
	note?: string;
	createdAt: string;
	budgetUsd: number;
	plan: { models: string[]; variants: string[]; cases: string[]; rounds: number };
	records: ScoredRecord[];
}
