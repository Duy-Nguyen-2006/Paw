export interface RgbColor {
	r: number;
	g: number;
	b: number;
}

function hexToRgb(hex: string): RgbColor {
	const normalized = hex.startsWith("#") ? hex.slice(1) : hex;
	const r = parseInt(normalized.slice(0, 2), 16);
	const g = parseInt(normalized.slice(2, 4), 16);
	const b = parseInt(normalized.slice(4, 6), 16);
	return { r, g, b };
}

function parseOscHexChannel(channel: string): number | undefined {
	if (!/^[0-9a-f]+$/i.test(channel)) {
		return undefined;
	}
	const max = 16 ** channel.length - 1;
	if (max <= 0) {
		return undefined;
	}
	return Math.round((parseInt(channel, 16) / max) * 255);
}

// OSC 11 escape sequence uses ESC (0x1B) and BEL (0x07) control characters
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const OSC11_BACKGROUND_COLOR_RESPONSE_PATTERN = new RegExp(
	`^${ESC}\\]11;([^${BEL}${ESC}]*)(?:${BEL}|${ESC}\\\\)$`,
	"i",
);

export function isOsc11BackgroundColorResponse(data: string): boolean {
	return OSC11_BACKGROUND_COLOR_RESPONSE_PATTERN.test(data);
}

export function parseOsc11BackgroundColor(data: string): RgbColor | undefined {
	const match = OSC11_BACKGROUND_COLOR_RESPONSE_PATTERN.exec(data);
	if (!match) {
		return undefined;
	}

	const value = match[1].trim();
	if (value.startsWith("#")) {
		const hex = value.slice(1);
		if (/^[0-9a-f]{6}$/i.test(hex)) {
			return hexToRgb(value);
		}
		if (/^[0-9a-f]{12}$/i.test(hex)) {
			const r = parseOscHexChannel(hex.slice(0, 4));
			const g = parseOscHexChannel(hex.slice(4, 8));
			const b = parseOscHexChannel(hex.slice(8, 12));
			return r !== undefined && g !== undefined && b !== undefined ? { r, g, b } : undefined;
		}
		return undefined;
	}

	const rgbValue = value.replace(/^rgba?:/i, "");
	const [red, green, blue] = rgbValue.split("/");
	if (red === undefined || green === undefined || blue === undefined) {
		return undefined;
	}
	const r = parseOscHexChannel(red);
	const g = parseOscHexChannel(green);
	const b = parseOscHexChannel(blue);
	return r !== undefined && g !== undefined && b !== undefined ? { r, g, b } : undefined;
}
