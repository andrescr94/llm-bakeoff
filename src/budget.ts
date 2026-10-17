import type { BakeoffConfig, Price } from './types.ts';

/**
 * The budget guard. A bake-off multiplies everything — models × prompts × cases × rounds —
 * and one thinking model with a large output cap can turn a cents experiment into dollars.
 * So the run computes its worst case first and refuses to start above the cap.
 *
 * The estimate is deliberately pessimistic:
 * - input tokens are counted as characters ÷ 3 (real English text runs nearer ÷ 4);
 * - every call is assumed to use its full `maxOutputTokens`;
 * - every call is assumed to be retried the maximum number of times;
 * - no prompt-cache discount is assumed.
 * The real spend is read from `usage.cost` as calls return, and that is what is reported.
 */

export const CHARS_PER_TOKEN_ESTIMATE = 3;

export class BudgetExceededError extends Error {
	constructor(
		readonly estimate: CostEstimate,
		readonly budgetUsd: number
	) {
		super(
			`Worst-case cost $${estimate.maxUsd.toFixed(4)} is above the $${budgetUsd.toFixed(2)} budget. ` +
				'Lower rounds, models, cases, maxOutputTokens or retries, or raise budgetUsd.'
		);
		this.name = 'BudgetExceededError';
	}
}

export interface CostEstimate {
	calls: number;
	maxUsd: number;
	perModel: { model: string; calls: number; maxUsd: number }[];
	missingPrices: string[];
}

export function estimateTokens(text: string): number {
	return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

export function countCalls(config: BakeoffConfig): number {
	return config.models.length * config.task.variants.length * config.task.cases.length * config.rounds;
}

export function estimateMaxCost(config: BakeoffConfig, prices: Record<string, Price>): CostEstimate {
	const { task } = config;
	const attempts = 1 + config.retries;
	// Sum the input of every (variant, case) pair once; each model sees the same set.
	let inputTokensPerRound = 0;
	for (const variant of task.variants) {
		for (const c of task.cases) inputTokensPerRound += estimateTokens(variant.system) + estimateTokens(c.user);
	}
	const callsPerModel = task.variants.length * task.cases.length * config.rounds;

	const missingPrices: string[] = [];
	const perModel = config.models.map(({ id }) => {
		const price = config.pricing?.[id] ?? prices[id];
		if (!price) {
			missingPrices.push(id);
			return { model: id, calls: callsPerModel, maxUsd: Number.POSITIVE_INFINITY };
		}
		const input = inputTokensPerRound * config.rounds * price.prompt;
		const output = callsPerModel * config.maxOutputTokens * price.completion;
		return { model: id, calls: callsPerModel, maxUsd: (input + output) * attempts };
	});

	return {
		calls: callsPerModel * config.models.length,
		maxUsd: perModel.reduce((sum, m) => sum + m.maxUsd, 0),
		perModel,
		missingPrices
	};
}

/** Throws unless the worst case fits the budget. A model with no known price never fits. */
export function assertWithinBudget(config: BakeoffConfig, prices: Record<string, Price>): CostEstimate {
	const estimate = estimateMaxCost(config, prices);
	if (estimate.missingPrices.length > 0) {
		throw new Error(
			`No price for ${estimate.missingPrices.join(', ')}, so the worst case cannot be bounded. ` +
				'Check the ids against https://openrouter.ai/api/v1/models or set `pricing` in the config.'
		);
	}
	if (estimate.maxUsd > config.budgetUsd) throw new BudgetExceededError(estimate, config.budgetUsd);
	return estimate;
}
