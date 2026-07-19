import { describe, expect, it } from "vitest";
import {
	inferLegacyExplicitBaseline,
	shouldPersistHistory,
} from "./persistence";
import type { NoteHistory } from "../types";

function history(overrides: Partial<NoteHistory> = {}): NoteHistory {
	return {
		path: "Note.md",
		createdDay: "2026-07-01",
		explicitBaseline: false,
		lastContent: "Baseline",
		contentHash: "12345678",
		dayOrder: [],
		spans: [],
		taskCompletions: [],
		...overrides,
	};
}

describe("metadata persistence", () => {
	it("does not persist an implicit baseline-only history", () => {
		expect(shouldPersistHistory(history())).toBe(false);
	});

	it("persists histories with annotations, deleted annotation dates, or an explicit baseline", () => {
		expect(
			shouldPersistHistory(
				history({
					dayOrder: ["2026-07-02"],
					spans: [{ from: 0, to: 4, day: "2026-07-02" }],
				}),
			),
		).toBe(true);
		expect(
			shouldPersistHistory(history({ dayOrder: ["2026-07-02"] })),
		).toBe(true);
		expect(shouldPersistHistory(history({ explicitBaseline: true }))).toBe(
			true,
		);
		expect(
			shouldPersistHistory(
				history({
					taskCompletions: [{ from: 3, to: 4, day: "2026-07-02" }],
				}),
			),
		).toBe(true);
	});

	it("recognizes legacy reset baselines without retaining ordinary baselines", () => {
		const baseline = history();
		expect(inferLegacyExplicitBaseline(baseline, "2026-07-01")).toBe(false);
		expect(inferLegacyExplicitBaseline(baseline, "2026-06-01")).toBe(true);
		expect(inferLegacyExplicitBaseline(baseline, null)).toBe(true);
		expect(
			inferLegacyExplicitBaseline(
				history({ dayOrder: ["2026-07-02"] }),
				"2026-07-01",
			),
		).toBe(false);
	});

});
