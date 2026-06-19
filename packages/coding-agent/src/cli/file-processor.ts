/**
 * Process @file CLI arguments into text content and image attachments
 */

import { access, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import chalk from "chalk";
import { resolveReadPath } from "../core/tools/path-utils.ts";
import { detectSupportedImageMimeTypeFromFile } from "../utils/mime.ts";
import { processImageFileArgument, processTextFileArgument } from "./file-processor-helpers.ts";

export interface ProcessedFiles {
	text: string;
	images: ImageContent[];
}

export interface ProcessFileOptions {
	/** Whether to auto-resize images to 2000x2000 max. Default: true */
	autoResizeImages?: boolean;
}

/** Process @file arguments into text content and image attachments */
export async function processFileArguments(fileArgs: string[], options?: ProcessFileOptions): Promise<ProcessedFiles> {
	const autoResizeImages = options?.autoResizeImages ?? true;
	let text = "";
	const images: ImageContent[] = [];

	for (const fileArg of fileArgs) {
		// Expand and resolve path (handles ~ expansion and macOS screenshot Unicode spaces)
		const absolutePath = resolve(resolveReadPath(fileArg, process.cwd()));

		// Check if file exists
		try {
			await access(absolutePath);
		} catch {
			console.error(chalk.red(`Error: File not found: ${absolutePath}`));
			process.exit(1);
		}

		// Check if file is empty
		const stats = await stat(absolutePath);
		if (stats.size === 0) {
			// Skip empty files
			continue;
		}

		const mimeType = await detectSupportedImageMimeTypeFromFile(absolutePath);

		if (mimeType) {
			const imageResult = await processImageFileArgument(absolutePath, autoResizeImages);
			text += imageResult.text;
			if (imageResult.image) {
				images.push(imageResult.image);
			}
		} else {
			text += await processTextFileArgument(absolutePath);
		}
	}

	return { text, images };
}
