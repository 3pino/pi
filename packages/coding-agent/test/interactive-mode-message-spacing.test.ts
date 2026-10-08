import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai/compat";
import { Container, type MarkdownTheme, Text } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { MarkdownTransformer } from "../src/core/extensions/types.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { getMarkdownTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

type MessageContext = {
	chatContainer: Container;
	toolOutputExpanded: boolean;
	outputPad: number;
	editor: { addToHistory(text: string): void };
	getUserMessageText(message: Message): string;
	getMarkdownThemeWithSettings(): MarkdownTheme;
	getMarkdownTransformers(): MarkdownTransformer[];
};

const addMessageToChat = Reflect.get(InteractiveMode.prototype, "addMessageToChat") as (
	this: MessageContext,
	message: AgentMessage,
	options?: { populateHistory?: boolean },
) => void;
const getUserMessageText = Reflect.get(InteractiveMode.prototype, "getUserMessageText") as (message: Message) => string;

const skillText = '<skill name="example-skill" location="/tmp/SKILL.md">\nskill details\n</skill>';

const messages = [
	{ name: "user message", text: "hello", lastLine: "hello" },
	{ name: "skill invocation", text: skillText, lastLine: "[skill]" },
	{ name: "skill with user message", text: `${skillText}\n\nhello`, lastLine: "hello" },
];

describe("InteractiveMode message spacing", () => {
	beforeAll(() => initTheme("dark"));

	test.each(messages)("$name has no surrounding or separator blank lines", ({ text, lastLine }) => {
		for (const outputPad of [0, 1]) {
			for (const withPreviousMessage of [false, true]) {
				const chatContainer = new Container();
				if (withPreviousMessage) chatContainer.addChild(new Text("previous", 0, 0));
				const addToHistory = vi.fn();
				const context: MessageContext = {
					chatContainer,
					toolOutputExpanded: false,
					outputPad,
					editor: { addToHistory },
					getUserMessageText,
					getMarkdownThemeWithSettings: getMarkdownTheme,
					getMarkdownTransformers: () => [],
				};
				addMessageToChat.call(context, { role: "user", content: text, timestamp: 0 }, { populateHistory: true });
				const lines = chatContainer.render(80).map((line) => stripAnsi(line).trim());
				expect(lines).not.toContain("");
				expect(lines.at(-1)).toContain(lastLine);
				if (withPreviousMessage) expect(lines[0]).toBe("previous");
				if (text.startsWith("<skill")) {
					expect(lines[withPreviousMessage ? 1 : 0]).toContain("[skill] example-skill");
					expect(lines).not.toContain("skill details");
				}
				expect(addToHistory).toHaveBeenCalledWith(text);
			}
		}
	});
});
