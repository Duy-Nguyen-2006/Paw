import OpenAI from "openai";
import type {
	ChatCompletion,
	ChatCompletionContentPart,
	ChatCompletionContentPartImage,
	ChatCompletionContentPartText,
	ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions.js";
import type {
	AssistantImages,
	ImageContent,
	ImagesContext,
	ImagesFunction,
	ImagesModel,
	ImagesOptions,
	TextContent,
} from "../../types.ts";
import { headersToRecord } from "../../utils/headers.ts";
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.ts";

interface OpenRouterGeneratedImage {
	image_url?: string | { url?: string };
}

type OpenRouterImageGenerationMessage = ChatCompletion["choices"][number]["message"] & {
	images?: OpenRouterGeneratedImage[];
};

type OpenRouterImageGenerationChoice = ChatCompletion["choices"][number] & {
	message: OpenRouterImageGenerationMessage;
};

type OpenRouterImageGenerationResponse = ChatCompletion & {
	choices: OpenRouterImageGenerationChoice[];
};

export const generateImagesOpenRouter: ImagesFunction<"openrouter-images", ImagesOptions> = async (
	model: ImagesModel<"openrouter-images">,
	context: ImagesContext,
	options?: ImagesOptions,
) => {
	const output: AssistantImages = {
		api: model.api,
		provider: model.provider,
		model: model.id,
		output: [],
		stopReason: "stop",
		timestamp: Date.now(),
	};

	try {
		const apiKey = options?.apiKey;
		if (!apiKey) {
			throw new Error(`No API key for provider: ${model.provider}`);
		}
		const client = createClient(model, apiKey, options?.headers);
		const params = await resolveOpenRouterParams(model, context, options);
		const requestOptions = buildOpenRouterRequestOptions(options);
		const { data: response, response: rawResponse } = await client.chat.completions
			.create(params as unknown as ChatCompletionCreateParamsNonStreaming, requestOptions)
			.withResponse();
		await options?.onResponse?.({ status: rawResponse.status, headers: headersToRecord(rawResponse.headers) }, model);

		applyOpenRouterResponse(output, response as OpenRouterImageGenerationResponse, model);
		return output;
	} catch (error) {
		output.stopReason = options?.signal?.aborted ? "aborted" : "error";
		output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
		return output;
	}
};

/** Apply `onPayload` and return the final request parameters. */
async function resolveOpenRouterParams(
	model: ImagesModel<"openrouter-images">,
	context: ImagesContext,
	options?: ImagesOptions,
): Promise<OpenRouterImagesCreateParams> {
	let params = buildParams(model, context);
	const nextParams = await options?.onPayload?.(params, model);
	if (nextParams !== undefined) params = nextParams as typeof params;
	return params;
}

/** Build the OpenAI client request options (signal/timeout/retries) from `ImagesOptions`. */
function buildOpenRouterRequestOptions(options?: ImagesOptions): {
	signal?: AbortSignal;
	timeout?: number;
	maxRetries: number;
} {
	return {
		...(options?.signal ? { signal: options.signal } : {}),
		...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
		maxRetries: options?.maxRetries ?? 0,
	};
}

/** Copy the OpenRouter image response into the `AssistantImages` output. */
function applyOpenRouterResponse(
	output: AssistantImages,
	response: OpenRouterImageGenerationResponse,
	model: ImagesModel<"openrouter-images">,
): void {
	output.responseId = response.id;
	if (response.usage) output.usage = parseUsage(response.usage, model);

	const choice = response.choices[0];
	if (!choice) return;
	appendOpenRouterChoiceContent(output, choice);
}

/** Append text and image content blocks from an OpenRouter choice. */
function appendOpenRouterChoiceContent(output: AssistantImages, choice: OpenRouterImageGenerationChoice): void {
	const content = choice.message.content;
	if (typeof content === "string" && content.length > 0) {
		output.output.push({ type: "text", text: content } satisfies TextContent);
	}
	for (const image of choice.message.images ?? []) {
		const decoded = decodeOpenRouterDataUrl(image.image_url);
		if (decoded) output.output.push(decoded satisfies ImageContent);
	}
}

/** Decode an OpenRouter `image_url` (string or object) into an `ImageContent` or `undefined`. */
function decodeOpenRouterDataUrl(
	imageUrl: string | { url?: string } | undefined,
): { type: "image"; mimeType: string; data: string } | undefined {
	const url = typeof imageUrl === "string" ? imageUrl : imageUrl?.url;
	if (!url?.startsWith("data:")) return undefined;
	const matches = /^data:([^;]+);base64,(.+)$/.exec(url);
	if (!matches) return undefined;
	return { type: "image", mimeType: matches[1], data: matches[2] };
}

function createClient(
	model: ImagesModel<"openrouter-images">,
	apiKey: string,
	optionsHeaders?: Record<string, string>,
): OpenAI {
	return new OpenAI({
		apiKey,
		baseURL: model.baseUrl,
		dangerouslyAllowBrowser: true,
		defaultHeaders: {
			...model.headers,
			...optionsHeaders,
		},
	});
}

type OpenRouterImagesCreateParams = Omit<ChatCompletionCreateParamsNonStreaming, "modalities"> & {
	modalities: Array<"image" | "text">;
};

function buildParams(model: ImagesModel<"openrouter-images">, context: ImagesContext): OpenRouterImagesCreateParams {
	const content: ChatCompletionContentPart[] = context.input.map((item): ChatCompletionContentPart => {
		if (item.type === "text") {
			return {
				type: "text",
				text: sanitizeSurrogates(item.text),
			} satisfies ChatCompletionContentPartText;
		}
		return {
			type: "image_url",
			image_url: {
				url: `data:${item.mimeType};base64,${item.data}`,
			},
		} satisfies ChatCompletionContentPartImage;
	});

	return {
		model: model.id,
		messages: [
			{
				role: "user" as const,
				content,
			},
		],
		stream: false,
		modalities: model.output.includes("text") ? ["image", "text"] : ["image"],
	};
}

function parseUsage(
	rawUsage: {
		prompt_tokens?: number;
		completion_tokens?: number;
		prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
	},
	model: ImagesModel<"openrouter-images">,
) {
	const promptTokens = rawUsage.prompt_tokens || 0;
	const reportedCachedTokens = rawUsage.prompt_tokens_details?.cached_tokens || 0;
	const cacheWriteTokens = rawUsage.prompt_tokens_details?.cache_write_tokens || 0;
	const cacheReadTokens =
		cacheWriteTokens > 0 ? Math.max(0, reportedCachedTokens - cacheWriteTokens) : reportedCachedTokens;
	const input = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);
	const output = rawUsage.completion_tokens || 0;
	const usage = {
		input,
		output,
		cacheRead: cacheReadTokens,
		cacheWrite: cacheWriteTokens,
		totalTokens: input + output + cacheReadTokens + cacheWriteTokens,
		cost: {
			input: (model.cost.input / 1000000) * input,
			output: (model.cost.output / 1000000) * output,
			cacheRead: (model.cost.cacheRead / 1000000) * cacheReadTokens,
			cacheWrite: (model.cost.cacheWrite / 1000000) * cacheWriteTokens,
			total: 0,
		},
	};
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
	return usage;
}
