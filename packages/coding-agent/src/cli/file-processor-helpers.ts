/**
 * @file CLI argument processing helpers (extracted from file-processor.ts for S3776).
 */

import { readFile } from "node:fs/promises";
import type { ImageContent } from "@earendil-works/pi-ai";
import chalk from "chalk";
import { formatDimensionNote, resizeImage } from "../utils/image-resize.ts";
import { detectSupportedImageMimeTypeFromFile } from "../utils/mime.ts";

export async function processImageFileArgument(
	absolutePath: string,
	autoResizeImages: boolean,
): Promise<{ text: string; image?: ImageContent }> {
	const content = await readFile(absolutePath);
	let attachment: ImageContent;
	let dimensionNote: string | undefined;

	if (autoResizeImages) {
		const mimeType = await detectSupportedImageMimeTypeFromFile(absolutePath);
		if (!mimeType) {
			return { text: `<file name="${absolutePath}">[Image omitted: unknown format.]\n` };
		}
		const resized = await resizeImage(content, mimeType);
		if (!resized) {
			return {
				text: `<file name="${absolutePath}">[Image omitted: could not be resized below the inline image size limit.]\n`,
			};
		}
		dimensionNote = formatDimensionNote(resized);
		attachment = {
			type: "image",
			mimeType: resized.mimeType,
			data: resized.data,
		};
	} else {
		const mimeType = await detectSupportedImageMimeTypeFromFile(absolutePath);
		if (!mimeType) {
			return { text: `<file name="${absolutePath}">[Image omitted: unknown format.]\n` };
		}
		attachment = {
			type: "image",
			mimeType,
			data: content.toString("base64"),
		};
	}

	const text = dimensionNote ? `<file name="${absolutePath}">${dimensionNote}\n` : `<file name="${absolutePath}">\n`;
	return { text, image: attachment };
}

export async function processTextFileArgument(absolutePath: string): Promise<string> {
	try {
		const content = await readFile(absolutePath, "utf-8");
		return `<file name="${absolutePath}">\n${content}\n</file>\n`;
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(chalk.red(`Error: Could not read file ${absolutePath}: ${message}`));
		process.exit(1);
	}
}
