/**
 * Overlay layout resolution for TUI (S3776).
 */

import type { OverlayAnchor, OverlayOptions, SizeValue } from "./tui.ts";

export function parseSizeValue(value: SizeValue | undefined, referenceSize: number): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "number") return value;
	const match = /^(\d+(?:\.\d+)?)%$/.exec(value);
	if (match) {
		return Math.floor((referenceSize * Number.parseFloat(match[1])) / 100);
	}
	return undefined;
}

export function resolveAnchorRow(
	anchor: OverlayAnchor,
	height: number,
	availHeight: number,
	marginTop: number,
): number {
	switch (anchor) {
		case "top-left":
		case "top-center":
		case "top-right":
			return marginTop;
		case "bottom-left":
		case "bottom-center":
		case "bottom-right":
			return marginTop + availHeight - height;
		case "left-center":
		case "center":
		case "right-center":
			return marginTop + Math.floor((availHeight - height) / 2);
	}
}

export function resolveAnchorCol(
	anchor: OverlayAnchor,
	width: number,
	availWidth: number,
	marginLeft: number,
): number {
	switch (anchor) {
		case "top-left":
		case "left-center":
		case "bottom-left":
			return marginLeft;
		case "top-right":
		case "right-center":
		case "bottom-right":
			return marginLeft + availWidth - width;
		case "top-center":
		case "center":
		case "bottom-center":
			return marginLeft + Math.floor((availWidth - width) / 2);
	}
}

export function resolvePercentRow(optRow: string, effectiveHeight: number, availHeight: number, marginTop: number): number {
	const match = /^(\d+(?:\.\d+)?)%$/.exec(optRow);
	if (!match) {
		return resolveAnchorRow("center", effectiveHeight, availHeight, marginTop);
	}
	const maxRow = Math.max(0, availHeight - effectiveHeight);
	const percent = Number.parseFloat(match[1]) / 100;
	return marginTop + Math.floor(maxRow * percent);
}

export function resolvePercentCol(optCol: string, width: number, availWidth: number, marginLeft: number): number {
	const match = /^(\d+(?:\.\d+)?)%$/.exec(optCol);
	if (!match) {
		return resolveAnchorCol("center", width, availWidth, marginLeft);
	}
	const maxCol = Math.max(0, availWidth - width);
	const percent = Number.parseFloat(match[1]) / 100;
	return marginLeft + Math.floor(maxCol * percent);
}

export function normalizeOverlayMargin(opt: OverlayOptions): {
	marginTop: number;
	marginRight: number;
	marginBottom: number;
	marginLeft: number;
} {
	const margin =
		typeof opt.margin === "number"
			? { top: opt.margin, right: opt.margin, bottom: opt.margin, left: opt.margin }
			: (opt.margin ?? {});
	return {
		marginTop: Math.max(0, margin.top ?? 0),
		marginRight: Math.max(0, margin.right ?? 0),
		marginBottom: Math.max(0, margin.bottom ?? 0),
		marginLeft: Math.max(0, margin.left ?? 0),
	};
}

export function resolveOverlayLayoutFromOptions(
	options: OverlayOptions | undefined,
	overlayHeight: number,
	termWidth: number,
	termHeight: number,
): { width: number; row: number; col: number; maxHeight: number | undefined } {
	const opt = options ?? {};
	const { marginTop, marginRight, marginBottom, marginLeft } = normalizeOverlayMargin(opt);

	const availWidth = Math.max(1, termWidth - marginLeft - marginRight);
	const availHeight = Math.max(1, termHeight - marginTop - marginBottom);

	let width = parseSizeValue(opt.width, termWidth) ?? Math.min(80, availWidth);
	if (opt.minWidth !== undefined) {
		width = Math.max(width, opt.minWidth);
	}
	width = Math.max(1, Math.min(width, availWidth));

	let maxHeight = parseSizeValue(opt.maxHeight, termHeight);
	if (maxHeight !== undefined) {
		maxHeight = Math.max(1, Math.min(maxHeight, availHeight));
	}

	const effectiveHeight = maxHeight !== undefined ? Math.min(overlayHeight, maxHeight) : overlayHeight;
	const anchor = opt.anchor ?? "center";

	let row: number;
	if (opt.row !== undefined) {
		if (typeof opt.row === "string") {
			row = resolvePercentRow(opt.row, effectiveHeight, availHeight, marginTop);
		} else {
			row = opt.row;
		}
	} else {
		row = resolveAnchorRow(anchor, effectiveHeight, availHeight, marginTop);
	}

	let col: number;
	if (opt.col !== undefined) {
		if (typeof opt.col === "string") {
			col = resolvePercentCol(opt.col, width, availWidth, marginLeft);
		} else {
			col = opt.col;
		}
	} else {
		col = resolveAnchorCol(anchor, width, availWidth, marginLeft);
	}

	if (opt.offsetY !== undefined) row += opt.offsetY;
	if (opt.offsetX !== undefined) col += opt.offsetX;

	row = Math.max(marginTop, Math.min(row, termHeight - marginBottom - effectiveHeight));
	col = Math.max(marginLeft, Math.min(col, termWidth - marginRight - width));

	return { width, row, col, maxHeight };
}
