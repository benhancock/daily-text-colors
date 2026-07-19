import { describe, expect, it } from "vitest";
import { addTextAnchors } from "./anchors";

describe("text anchors", () => {
	it("stores exact text, surrounding context, and a position hint", () => {
		const content = `${"a".repeat(40)}marked${"z".repeat(40)}`;
		const spans = addTextAnchors(
			[{ from: 40, to: 46, day: "2026-07-04" }],
			content,
		);

		expect(spans).toEqual([
			{
				from: 40,
				to: 46,
				day: "2026-07-04",
				anchor: {
					exact: "marked",
					prefix: "a".repeat(32),
					suffix: "z".repeat(32),
					position: 40,
				},
			},
		]);
	});
});
