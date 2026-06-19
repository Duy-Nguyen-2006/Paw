/**
 * Escape sequence completeness checks for StdinBuffer (S3776).
 */

const ESC = "\x1b";

export function isCompleteCsiSequence(data: string): "complete" | "incomplete" {
	if (!data.startsWith(`${ESC}[`)) {
		return "complete";
	}

	if (data.length < 3) {
		return "incomplete";
	}

	const payload = data.slice(2);
	const lastChar = payload[payload.length - 1];
	const lastCharCode = lastChar.codePointAt(0)!;

	if (lastCharCode >= 0x40 && lastCharCode <= 0x7e) {
		if (payload.startsWith("<")) {
			const mouseMatch = /^<\d+;\d+;\d+[Mm]$/.test(payload);
			if (mouseMatch) {
				return "complete";
			}
			if (lastChar === "M" || lastChar === "m") {
				const parts = payload.slice(1, -1).split(";");
				if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) {
					return "complete";
				}
			}
			return "incomplete";
		}
		return "complete";
	}

	return "incomplete";
}

export function isCompleteOscSequence(data: string): "complete" | "incomplete" {
	if (!data.startsWith(`${ESC}]`)) {
		return "complete";
	}
	if (data.endsWith(`${ESC}\\`) || data.endsWith("\x07")) {
		return "complete";
	}
	return "incomplete";
}

export function isCompleteDcsSequence(data: string): "complete" | "incomplete" {
	if (!data.startsWith(`${ESC}P`)) {
		return "complete";
	}
	if (data.endsWith(`${ESC}\\`)) {
		return "complete";
	}
	return "incomplete";
}

export function isCompleteApcSequence(data: string): "complete" | "incomplete" {
	if (!data.startsWith(`${ESC}_`)) {
		return "complete";
	}
	if (data.endsWith(`${ESC}\\`)) {
		return "complete";
	}
	return "incomplete";
}

export function isCompleteEscapeSequence(data: string): "complete" | "incomplete" | "not-escape" {
	if (!data.startsWith(ESC)) {
		return "not-escape";
	}

	if (data.length === 1) {
		return "incomplete";
	}

	const afterEsc = data.slice(1);

	if (afterEsc.startsWith("[")) {
		if (afterEsc.startsWith("[M")) {
			return data.length >= 6 ? "complete" : "incomplete";
		}
		return isCompleteCsiSequence(data);
	}

	if (afterEsc.startsWith("]")) {
		return isCompleteOscSequence(data);
	}

	if (afterEsc.startsWith("P")) {
		return isCompleteDcsSequence(data);
	}

	if (afterEsc.startsWith("_")) {
		return isCompleteApcSequence(data);
	}

	if (afterEsc.startsWith("O")) {
		return afterEsc.length >= 2 ? "complete" : "incomplete";
	}

	if (afterEsc.length === 1) {
		return "complete";
	}

	return "complete";
}

export { ESC };
