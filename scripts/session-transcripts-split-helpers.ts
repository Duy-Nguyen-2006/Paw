/**
 * Transcript file splitting (extracted from session-transcripts.ts for S3776).
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";

export const MAX_CHARS_PER_FILE = 100_000;

export function splitTranscriptsIntoFiles(allTranscripts: string[], outputDir: string): string[] {
	const outputFiles: string[] = [];
	let currentContent = "";
	let fileIndex = 0;

	const flushCurrent = () => {
		if (currentContent.length === 0) return;
		const filename = `session-transcripts-${String(fileIndex).padStart(3, "0")}.txt`;
		writeFileSync(join(outputDir, filename), currentContent);
		outputFiles.push(filename);
		console.log(`Wrote ${filename} (${currentContent.length} chars)`);
		currentContent = "";
		fileIndex++;
	};

	for (const transcript of allTranscripts) {
		if (currentContent.length > 0 && currentContent.length + transcript.length + 2 > MAX_CHARS_PER_FILE) {
			flushCurrent();
		}

		if (transcript.length > MAX_CHARS_PER_FILE) {
			flushCurrent();
			const filename = `session-transcripts-${String(fileIndex).padStart(3, "0")}.txt`;
			writeFileSync(join(outputDir, filename), transcript);
			outputFiles.push(filename);
			console.log(chalk.yellow(`Wrote ${filename} (${transcript.length} chars) - oversized`));
			fileIndex++;
			continue;
		}

		currentContent += (currentContent ? "\n\n" : "") + transcript;
	}

	flushCurrent();
	return outputFiles;
}
