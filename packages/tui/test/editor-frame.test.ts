import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { Editor } from "../src/components/editor.ts";
import { CURSOR_MARKER, type TuiMouseEvent } from "../src/tui.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { visibleWidth } from "../src/utils.ts";
import { defaultEditorTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

function createEditor(paddingX = 1): Editor {
	return new Editor(new TuiMainScreen(new VirtualTerminal(80, 10)), defaultEditorTheme, {
		sideBorders: true,
		paddingX,
	});
}

function click(x: number, y: number, width: number): TuiMouseEvent {
	return {
		type: "click",
		button: "left",
		x,
		y,
		screenX: x,
		screenY: y,
		width,
		height: 10,
		shift: false,
		alt: false,
		ctrl: false,
		clickCount: 1,
	};
}

describe("Editor frame", () => {
	it("encloses empty and multiline input with rounded corners", () => {
		const editor = createEditor();
		assert.deepEqual(editor.render(12).map(stripVTControlCharacters), [
			"╭──────────╮",
			"│          │",
			"╰──────────╯",
		]);
		editor.setText("hello\n世界");
		assert.deepEqual(editor.render(12).map(stripVTControlCharacters), [
			"╭──────────╮",
			"│ hello    │",
			"│ 世界     │",
			"╰──────────╯",
		]);
	});

	it("keeps wrapping, cursor markers, and wide graphemes inside the frame", () => {
		for (const paddingX of [0, 1, 10]) {
			for (const width of [5, 6, 8, 12, 40]) {
				const editor = createEditor(paddingX);
				editor.focused = true;
				editor.setText("日本語🙂abcdefghijk");
				const lines = editor.render(width);
				assert.equal(lines.filter((line) => line.includes(CURSOR_MARKER)).length, 1);
				for (const line of lines) assert.equal(visibleWidth(line), width);
				for (const line of lines.slice(1, -1)) {
					assert.match(stripVTControlCharacters(line), /^│.*│$/);
				}
			}
		}
	});

	it("lets an end cursor use padding without overwriting the right border", () => {
		const editor = createEditor();
		editor.setText("abcdefgh");
		assert.equal(stripVTControlCharacters(editor.render(12)[1]!), "│ abcdefgh │");
		assert.equal(visibleWidth(editor.render(12)[1]!), 12);
	});

	it("falls back to horizontal rules in very narrow terminals", () => {
		const editor = createEditor();
		for (const width of [1, 2, 3, 4]) {
			const lines = editor.render(width);
			assert.equal(stripVTControlCharacters(lines[0]!), "─".repeat(width));
			for (const line of lines) assert.equal(visibleWidth(line), width);
		}
	});

	it("accounts for the left frame and padding when clicking wrapped text", () => {
		const editor = createEditor();
		editor.setText("abcdefghijk");
		editor.render(12);
		editor.handleMouse(click(4, 1, 12));
		assert.deepEqual(editor.getCursor(), { line: 0, col: 2 });
		editor.handleMouse(click(3, 2, 12));
		assert.deepEqual(editor.getCursor(), { line: 0, col: 9 });
	});

	it("retains scroll indicators inside the corners", () => {
		const editor = createEditor();
		editor.setText(Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n"));
		let lines = editor.render(30).map(stripVTControlCharacters);
		assert.match(lines[0]!, /^╭.*↑ 5 more.*╮$/);
		editor.handleInput("\x1b[5~"); // Page up
		editor.handleInput("\x1b[5~");
		lines = editor.render(30).map(stripVTControlCharacters);
		assert.match(lines.at(-1)!, /^╰.*↓ 5 more.*╯$/);
	});

	it("aligns autocomplete outside the frame and accepts mouse selection", async () => {
		const editor = createEditor();
		editor.setAutocompleteProvider({
			getSuggestions: async () => ({ prefix: "/", items: [{ value: "/help", label: "/help" }] }),
			applyCompletion: () => ({ lines: ["/help"], cursorLine: 0, cursorCol: 5 }),
		});
		editor.handleInput("/");
		await new Promise<void>((resolve) => setImmediate(resolve));
		const lines = editor.render(30).map(stripVTControlCharacters);
		assert.match(lines[2]!, /^╰.*╯$/);
		assert.match(lines[3]!, /^ {2}/);
		assert.ok(lines[3]!.includes("/help"));
		for (const line of lines) assert.equal(visibleWidth(line), 30);
		assert.equal(editor.handleMouse(click(4, 3, 30))?.handled, true);
		assert.equal(editor.getText(), "/help");
	});
});
