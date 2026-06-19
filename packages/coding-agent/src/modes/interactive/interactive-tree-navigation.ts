/**
 * Tree navigation summary prompt (reduces showTreeSelector S3776).
 */

export interface TreeNavigationSummaryDeps {
	getBranchSummarySkipPrompt: () => boolean;
	showSummarySelector: () => Promise<string | undefined>;
	showCustomInstructionsEditor: () => Promise<string | undefined>;
	onReturnToTree: (entryId: string) => void;
}

export interface TreeNavigationSummaryResult {
	wantsSummary: boolean;
	customInstructions?: string;
	cancelledToTree: boolean;
}

export async function resolveTreeNavigationSummary(
	entryId: string,
	deps: TreeNavigationSummaryDeps,
): Promise<TreeNavigationSummaryResult> {
	if (deps.getBranchSummarySkipPrompt()) {
		return { wantsSummary: false, cancelledToTree: false };
	}

	while (true) {
		const summaryChoice = await deps.showSummarySelector();

		if (summaryChoice === undefined) {
			deps.onReturnToTree(entryId);
			return { wantsSummary: false, cancelledToTree: true };
		}

		if (summaryChoice === "No summary") {
			return { wantsSummary: false, cancelledToTree: false };
		}

		if (summaryChoice === "Summarize") {
			return { wantsSummary: true, cancelledToTree: false };
		}

		if (summaryChoice === "Summarize with custom prompt") {
			const customInstructions = await deps.showCustomInstructionsEditor();
			if (customInstructions === undefined) {
				continue;
			}
			return { wantsSummary: true, customInstructions, cancelledToTree: false };
		}
	}
}
