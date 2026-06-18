import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.ts";

describe("MiniMax-M3 provider metadata", () => {
	it("uses the OpenAI-compatible MiniMax v1 endpoint", () => {
		const model = getModel("minimax", "MiniMax-M3");

		expect(model.api).toBe("openai-completions");
		expect(model.provider).toBe("minimax");
		expect(model.baseUrl).toBe("https://api.minimax.io/v1");
		expect(model.compat?.thinkingFormat).toBe("zai");
		expect(model.id).toBe("MiniMax-M3");
	});
});
