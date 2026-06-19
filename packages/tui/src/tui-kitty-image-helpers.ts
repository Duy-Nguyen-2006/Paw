/**
 * Kitty graphics protocol helpers for TUI differential render (S3776).
 */

import { isImageLine } from "./terminal-image.ts";

const KITTY_SEQUENCE_PREFIX = "\x1b_G";

interface KittyImageHeader {
	ids: number[];
	rows: number;
}

function parseKittyImageHeader(line: string): KittyImageHeader | undefined {
	const sequenceStart = line.indexOf(KITTY_SEQUENCE_PREFIX);
	if (sequenceStart === -1) return undefined;

	const paramsStart = sequenceStart + KITTY_SEQUENCE_PREFIX.length;
	const paramsEnd = line.indexOf(";", paramsStart);
	if (paramsEnd === -1) return undefined;

	const ids: number[] = [];
	let rows = 1;
	const params = line.slice(paramsStart, paramsEnd);
	for (const param of params.split(",")) {
		const [key, value] = param.split("=", 2);
		if (value === undefined) continue;
		const numberValue = Number(value);
		if (!Number.isInteger(numberValue) || numberValue <= 0 || numberValue > 0xffffffff) continue;
		if (key === "i") {
			ids.push(numberValue);
		} else if (key === "r") {
			rows = numberValue;
		}
	}
	return { ids, rows };
}

export function extractKittyImageIds(line: string): number[] {
	return parseKittyImageHeader(line)?.ids ?? [];
}

export function extractKittyImageRows(line: string): number {
	return parseKittyImageHeader(line)?.rows ?? 1;
}

export function writeImageBlock(buffer: string, line: string, imageReservedRows: number): string {
	let next = `${buffer}\x1b[2K`;
	for (let row = 1; row < imageReservedRows; row++) {
		next += "\r\n\x1b[2K";
	}
	next += `\x1b[${imageReservedRows - 1}A`;
	next += line;
	next += `\x1b[${imageReservedRows - 1}B`;
	return next;
}

export function getKittyImageReservedRows(
	lines: string[],
	index: number,
	maxIndex: number,
	visibleWidth: (line: string) => number,
): number {
	const rows = extractKittyImageRows(lines[index] ?? "");
	if (rows <= 1) return 1;

	const maxRows = Math.min(rows, maxIndex - index + 1, lines.length - index);
	let reservedRows = 1;
	while (reservedRows < maxRows) {
		const line = lines[index + reservedRows] ?? "";
		if (isImageLine(line) || visibleWidth(line) > 0) break;
		reservedRows++;
	}
	return reservedRows;
}
