import {
	allocateImageId,
	getCapabilities,
	getCellDimensions,
	getImageDimensions,
	type ImageDimensions,
	imageFallback,
	renderImage,
} from "../terminal-image.ts";
import type { Component } from "../tui.ts";

export interface ImageTheme {
	fallbackColor: (str: string) => string;
}

export interface ImageOptions {
	maxWidthCells?: number;
	maxHeightCells?: number;
	filename?: string;
	/** Kitty image ID. If provided, reuses this ID (for animations/updates). */
	imageId?: number;
}

export class Image implements Component {
	private base64Data: string;
	private mimeType: string;
	private dimensions: ImageDimensions;
	private theme: ImageTheme;
	private options: ImageOptions;
	private imageId?: number;

	private cachedLines?: string[];
	private cachedWidth?: number;

	constructor(
		base64Data: string,
		mimeType: string,
		theme: ImageTheme,
		options: ImageOptions = {},
		dimensions?: ImageDimensions,
	) {
		this.base64Data = base64Data;
		this.mimeType = mimeType;
		this.theme = theme;
		this.options = options;
		this.dimensions = dimensions || getImageDimensions(base64Data, mimeType) || { widthPx: 800, heightPx: 600 };
		this.imageId = options.imageId;
	}

	/** Get the Kitty image ID used by this image (if any). */
	getImageId(): number | undefined {
		return this.imageId;
	}

	invalidate(): void {
		this.cachedLines = undefined;
		this.cachedWidth = undefined;
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const maxWidth = Math.max(1, Math.min(width - 2, this.options.maxWidthCells ?? 60));
		const cellDimensions = getCellDimensions();
		const defaultMaxHeight = Math.max(1, Math.ceil((maxWidth * cellDimensions.widthPx) / cellDimensions.heightPx));
		const maxHeight = this.options.maxHeightCells ?? defaultMaxHeight;

		const lines = this.renderImageLines(maxWidth, maxHeight);

		this.cachedLines = lines;
		this.cachedWidth = width;

		return lines;
	}

	private renderImageLines(maxWidth: number, maxHeight: number): string[] {
		const caps = getCapabilities();
		if (!caps.images) {
			return this.renderFallback();
		}

		this.ensureKittyImageId(caps);

		const result = this.renderImageData(maxWidth, maxHeight);
		if (!result) {
			return this.renderFallback();
		}

		if (result.imageId) {
			this.imageId = result.imageId;
		}

		return caps.images === "kitty" ? this.buildKittyLines(result) : this.buildSixelLines(result);
	}

	/**
	 * Allocate a Kitty image ID when the terminal supports it and the image
	 * does not already have one.
	 */
	private ensureKittyImageId(caps: ReturnType<typeof getCapabilities>): void {
		if (caps.images === "kitty" && this.imageId === undefined) {
			this.imageId = allocateImageId();
		}
	}

	/**
	 * Render the image into a sequence string for the given dimensions. Returns
	 * null if the terminal cannot render the image.
	 */
	private renderImageData(
		maxWidth: number,
		maxHeight: number,
	): { sequence: string; rows: number; imageId?: number } | null {
		return renderImage(this.base64Data, this.dimensions, {
			maxWidthCells: maxWidth,
			maxHeightCells: maxHeight,
			imageId: this.imageId,
			moveCursor: false,
		});
	}

	private renderFallback(): string[] {
		const fallback = imageFallback(this.mimeType, this.dimensions, this.options.filename);
		return [this.theme.fallbackColor(fallback)];
	}

	private buildKittyLines(result: { sequence: string; rows: number }): string[] {
		const lines = [result.sequence];
		for (let i = 0; i < result.rows - 1; i++) {
			lines.push("");
		}
		return lines;
	}

	private buildSixelLines(result: { sequence: string; rows: number }): string[] {
		const lines: string[] = [];
		for (let i = 0; i < result.rows - 1; i++) {
			lines.push("");
		}
		const rowOffset = result.rows - 1;
		const moveUp = rowOffset > 0 ? `\x1b[${rowOffset}A` : "";
		lines.push(moveUp + result.sequence);
		return lines;
	}
}
