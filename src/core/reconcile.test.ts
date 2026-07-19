import { describe, expect, it } from "vitest";
import { reconcileContent, reconcileTaskCompletions } from "./reconcile";

describe("external edit reconciliation", () => {
	it("preserves mapped history and dates newly detected prose", () => {
		const spans = reconcileContent({
			oldContent: "Alpha beta",
			newContent: "Start Alpha beta end",
			spans: [{ from: 6, to: 10, day: "2026-07-04" }],
			today: "2026-07-05",
			createdDay: "2026-07-03",
		});

		expect(spans).toEqual([
			{ from: 0, to: 6, day: "2026-07-05" },
			{ from: 12, to: 16, day: "2026-07-04" },
			{ from: 16, to: 20, day: "2026-07-05" },
		]);
	});

	it("preserves checked-task completion records through external edits", () => {
		expect(
			reconcileTaskCompletions({
				oldContent: "- [x] task",
				newContent: "Intro\n- [x] task",
				completions: [{ from: 3, to: 4, day: "2026-07-04" }],
			}),
		).toEqual([{ from: 9, to: 10, day: "2026-07-04" }]);
	});
});
