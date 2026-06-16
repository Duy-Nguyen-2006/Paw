import type { PawRiskLevel, PawValidationIssue, PawValidationResult } from "./contracts.ts";

export type PawPlannerSlice = {
	slice_id: string;
	title: string;
	order: number;
	target_files?: string[];
	max_risk_level?: PawRiskLevel;
	acceptance?: string;
};

export type PawPlanSliceQueue = {
	slices: PawPlannerSlice[];
	slice_ids: string[];
};

const PAW_RISK_LEVELS = ["R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7"] as const;

const ALLOWED_SLICE_PROPERTIES = new Set([
	"slice_id",
	"title",
	"order",
	"target_files",
	"max_risk_level",
	"acceptance",
]);

export function createPawPlanSliceQueue(input: unknown): PawValidationResult<PawPlanSliceQueue> {
	if (!Array.isArray(input) || input.length === 0) {
		return {
			ok: false,
			issues: [{ path: "/", message: "Planner slice input must be a non-empty array." }],
		};
	}

	const issues: PawValidationIssue[] = [];
	const slices: PawPlannerSlice[] = [];
	const seenSliceIds = new Set<string>();
	const seenOrders = new Set<number>();

	for (const [index, item] of input.entries()) {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			issues.push({ path: `/${index}`, message: "Planner slice must be an object." });
			continue;
		}

		for (const property of Object.keys(item)) {
			if (!ALLOWED_SLICE_PROPERTIES.has(property)) {
				issues.push({ path: `/${index}/${property}`, message: `Unexpected planner slice property ${property}.` });
			}
		}

		const sliceId = validateRequiredString(issues, item, "slice_id", `/${index}/slice_id`, "Slice id is required.");
		const title = validateRequiredString(issues, item, "title", `/${index}/title`, "Slice title is required.");
		const order = validateOrder(issues, item, index);
		const targetFiles = validateTargetFiles(issues, item, index);
		const maxRiskLevel = validateMaxRiskLevel(issues, item, index);
		const acceptance = validateAcceptance(issues, item, index);

		if (sliceId !== undefined) {
			if (seenSliceIds.has(sliceId)) {
				issues.push({ path: `/${index}/slice_id`, message: `Duplicate slice id ${sliceId}.` });
			}
			seenSliceIds.add(sliceId);
		}
		if (order !== undefined) {
			if (seenOrders.has(order)) {
				issues.push({ path: `/${index}/order`, message: `Duplicate slice order ${order}.` });
			}
			seenOrders.add(order);
		}

		if (
			sliceId !== undefined &&
			title !== undefined &&
			order !== undefined &&
			targetFiles.valid &&
			maxRiskLevel.valid &&
			acceptance.valid
		) {
			const slice: PawPlannerSlice = {
				slice_id: sliceId,
				title,
				order,
			};
			if (targetFiles.value !== undefined) {
				slice.target_files = targetFiles.value;
			}
			if (maxRiskLevel.value !== undefined) {
				slice.max_risk_level = maxRiskLevel.value;
			}
			if (acceptance.value !== undefined) {
				slice.acceptance = acceptance.value;
			}
			slices.push(slice);
		}
	}

	if (issues.length > 0) {
		return { ok: false, issues };
	}

	const sortedSlices = [...slices].sort((left, right) => left.order - right.order);
	return {
		ok: true,
		value: {
			slices: sortedSlices,
			slice_ids: sortedSlices.map((slice) => slice.slice_id),
		},
	};
}

function validateRequiredString(
	issues: PawValidationIssue[],
	item: Record<string, unknown>,
	key: string,
	path: string,
	message: string,
): string | undefined {
	const value = item[key];
	if (typeof value !== "string" || value.trim() === "") {
		issues.push({ path, message });
		return undefined;
	}
	return value;
}

function validateOrder(issues: PawValidationIssue[], item: Record<string, unknown>, index: number): number | undefined {
	const value = item.order;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		issues.push({ path: `/${index}/order`, message: "Slice order must be an integer greater than or equal to 0." });
		return undefined;
	}
	return value;
}

function validateTargetFiles(
	issues: PawValidationIssue[],
	item: Record<string, unknown>,
	index: number,
): { valid: true; value?: string[] } | { valid: false } {
	if (!("target_files" in item)) {
		return { valid: true };
	}
	if (!Array.isArray(item.target_files)) {
		issues.push({ path: `/${index}/target_files`, message: "Target files must be an array of non-empty strings." });
		return { valid: false };
	}

	const targetFiles: string[] = [];
	let valid = true;
	for (const [targetIndex, targetFile] of item.target_files.entries()) {
		if (typeof targetFile !== "string" || targetFile.trim() === "") {
			issues.push({
				path: `/${index}/target_files/${targetIndex}`,
				message: "Target file must be a non-empty string.",
			});
			valid = false;
			continue;
		}
		targetFiles.push(targetFile);
	}

	return valid ? { valid: true, value: targetFiles } : { valid: false };
}

function validateMaxRiskLevel(
	issues: PawValidationIssue[],
	item: Record<string, unknown>,
	index: number,
): { valid: true; value?: PawRiskLevel } | { valid: false } {
	if (!("max_risk_level" in item)) {
		return { valid: true };
	}
	const value = item.max_risk_level;
	if (typeof value !== "string" || !isPawRiskLevel(value)) {
		issues.push({ path: `/${index}/max_risk_level`, message: "Max risk level must be one of R0 through R7." });
		return { valid: false };
	}

	return { valid: true, value };
}

function isPawRiskLevel(value: string): value is PawRiskLevel {
	return PAW_RISK_LEVELS.includes(value as PawRiskLevel);
}

function validateAcceptance(
	issues: PawValidationIssue[],
	item: Record<string, unknown>,
	index: number,
): { valid: true; value?: string } | { valid: false } {
	if (!("acceptance" in item)) {
		return { valid: true };
	}
	if (typeof item.acceptance !== "string" || item.acceptance.trim() === "") {
		issues.push({ path: `/${index}/acceptance`, message: "Acceptance must be a non-empty string." });
		return { valid: false };
	}

	return { valid: true, value: item.acceptance };
}
