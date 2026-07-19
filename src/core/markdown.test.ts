import { describe, expect, it } from "vitest";
import { visibleProseRanges } from "./markdown";

function visibleText(content: string): string[] {
	return visibleProseRanges(content).map((range) => content.slice(range.from, range.to));
}

describe("visible prose detection", () => {
	it("excludes frontmatter, code, and Markdown syntax", () => {
		const content = [
			"---",
			"title: Hidden",
			"---",
			"# Heading",
			"Body **bold** and `code`.",
			"```ts",
			"const hidden = true;",
			"```",
		].join("\n");

		expect(visibleText(content)).toEqual([
			"Heading",
			"Body ",
			"bold",
			" and ",
			".",
		]);
	});

	it("colors link labels while excluding destinations", () => {
		const content = "[Visible label](https://example.com)";
		expect(visibleText(content)).toEqual(["Visible label"]);
	});

	it("uses wiki aliases as the visible text", () => {
		const content = "[[private-target|Public label]]";
		expect(visibleText(content)).toEqual(["Public label"]);
	});

	it("colors ordinary punctuation as part of prose", () => {
		const content = "A sentence (with commas, periods, [brackets], <angles>, and pipes | too).";
		expect(visibleText(content)).toEqual([content]);
	});

	it("excludes image and reference-link syntax while coloring labels", () => {
		const content = "![Image label](image.png) and [Reference label][reference]";
		expect(visibleText(content)).toEqual([
			"Image label",
			" and ",
			"Reference label",
		]);
	});

	it("excludes task checkbox markers while coloring task text", () => {
		const content = [
			"- [ ] Open task",
			"- [x] Done task",
			"1. [ ] Numbered task",
			"> - [X] Quoted task",
		].join("\n");

		expect(visibleText(content)).toEqual([
			"Open task",
			"Done task",
			"Numbered task",
			"Quoted task",
		]);
	});
});
