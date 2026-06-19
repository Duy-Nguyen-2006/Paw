/**
 * Tool execution display helpers (reduces ToolExecutionComponent.updateDisplay complexity).
 */

import { Box, type Component, Container, getCapabilities, Image, Spacer, Text } from "@earendil-works/pi-tui";
import type { ToolDefinition, ToolRenderContext } from "../../../core/extensions/types.ts";
import { getTextOutput as getRenderedTextOutput } from "../../../core/tools/render-utils.ts";
import { theme } from "../theme/theme.ts";

export type ToolResultContent = {
	content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
	isError: boolean;
	details?: unknown;
};

export interface ToolRendererShellState {
	toolName: string;
	args: unknown;
	result?: ToolResultContent;
	isPartial: boolean;
	expanded: boolean;
	showImages: boolean;
	imageWidthCells: number;
	executionStarted: boolean;
	argsComplete: boolean;
	cwd: string;
	toolCallId: string;
	rendererState: unknown;
	callRendererComponent?: Component;
	resultRendererComponent?: Component;
	getCallRenderer: () => ToolDefinition<unknown, unknown>["renderCall"] | undefined;
	getResultRenderer: () => ToolDefinition<unknown, unknown>["renderResult"] | undefined;
	getRenderShell: () => "default" | "self";
	getRenderContext: (lastComponent: Component | undefined) => ToolRenderContext;
	createCallFallback: () => Component;
	createResultFallback: () => Component | undefined;
	getTextOutput: () => string;
}

export function resolveToolDisplayBgFn(isPartial: boolean, result?: ToolResultContent): (text: string) => string {
	if (isPartial) {
		return (text: string) => theme.bg("toolPendingBg", text);
	}
	if (result?.isError) {
		return (text: string) => theme.bg("toolErrorBg", text);
	}
	return (text: string) => theme.bg("toolSuccessBg", text);
}

export function renderToolDefinitionShell(
	state: ToolRendererShellState,
	renderContainer: Container | Box,
	bgFn: (text: string) => string,
): boolean {
	if (renderContainer instanceof Box) {
		renderContainer.setBgFn(bgFn);
	}
	renderContainer.clear();

	const callRenderer = state.getCallRenderer();
	if (!callRenderer) {
		renderContainer.addChild(state.createCallFallback());
		return true;
	}

	try {
		const component = callRenderer(state.args, theme, state.getRenderContext(state.callRendererComponent));
		state.callRendererComponent = component;
		renderContainer.addChild(component);
		return true;
	} catch {
		state.callRendererComponent = undefined;
		renderContainer.addChild(state.createCallFallback());
		return true;
	}
}

export function renderToolResultInShell(state: ToolRendererShellState, renderContainer: Container | Box): boolean {
	if (!state.result) {
		return false;
	}

	const resultRenderer = state.getResultRenderer();
	if (!resultRenderer) {
		const component = state.createResultFallback();
		if (component) {
			renderContainer.addChild(component);
			return true;
		}
		return false;
	}

	try {
		const component = resultRenderer(
			{ content: state.result.content as never, details: state.result.details },
			{ expanded: state.expanded, isPartial: state.isPartial },
			theme,
			state.getRenderContext(state.resultRendererComponent),
		);
		state.resultRendererComponent = component;
		renderContainer.addChild(component);
		return true;
	} catch {
		state.resultRendererComponent = undefined;
		const component = state.createResultFallback();
		if (component) {
			renderContainer.addChild(component);
			return true;
		}
		return false;
	}
}

export function formatGenericToolExecution(toolName: string, args: unknown, result: ToolResultContent | undefined, showImages: boolean): string {
	let text = theme.fg("toolTitle", theme.bold(toolName));
	const content = JSON.stringify(args, null, 2);
	if (content) {
		text += `\n\n${content}`;
	}
	const output = getRenderedTextOutput(result, showImages);
	if (output) {
		text += `\n${output}`;
	}
	return text;
}

export interface ToolImageAttachResult {
	imageComponents: Image[];
	imageSpacers: Spacer[];
}

export function buildToolResultImageAttachments(
	result: ToolResultContent,
	showImages: boolean,
	imageWidthCells: number,
	convertedImages: Map<number, { data: string; mimeType: string }>,
): ToolImageAttachResult {
	const imageComponents: Image[] = [];
	const imageSpacers: Spacer[] = [];
	const caps = getCapabilities();
	const imageBlocks = result.content.filter((c) => c.type === "image");

	for (let i = 0; i < imageBlocks.length; i++) {
		const img = imageBlocks[i];
		if (!caps.images || !showImages || !img?.data || !img.mimeType) {
			continue;
		}
		const converted = convertedImages.get(i);
		const imageData = converted?.data ?? img.data;
		const imageMimeType = converted?.mimeType ?? img.mimeType;
		if (caps.images === "kitty" && imageMimeType !== "image/png") {
			continue;
		}

		imageSpacers.push(new Spacer(1));
		imageComponents.push(
			new Image(
				imageData,
				imageMimeType,
				{ fallbackColor: (s: string) => theme.fg("toolOutput", s) },
				{ maxWidthCells: imageWidthCells },
			),
		);
	}

	return { imageComponents, imageSpacers };
}
