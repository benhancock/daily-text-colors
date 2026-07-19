import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
	applyTaskCompletionChanges,
	taskCompletionLineRanges,
	taskCompletionTextRanges,
} from "./tasks";

function edit(
	oldContent: string,
	changes:
		| { from: number; to?: number; insert?: string }
		| Array<{ from: number; to?: number; insert?: string }>,
) {
	const state = EditorState.create({ doc: oldContent });
	return state.update({ changes });
}

describe("task completion annotations", () => {
	it("records the checked checkbox marker when enabled", () => {
		const oldContent = "- [ ] task text";
		const newContent = "- [x] task text";
		const transaction = edit(oldContent, { from: 3, to: 4, insert: "x" });

		expect(
			applyTaskCompletionChanges({
				completions: [],
				changes: transaction.changes,
				oldContent,
				newContent,
				today: "2026-07-05",
				createdDay: "2026-07-03",
				enabled: true,
			}),
		).toEqual([{ from: 3, to: 4, day: "2026-07-05" }]);
	});

	it("does not record creation-day checkbox checks", () => {
		const oldContent = "- [ ] task text";
		const newContent = "- [x] task text";
		const transaction = edit(oldContent, { from: 3, to: 4, insert: "x" });

		expect(
			applyTaskCompletionChanges({
				completions: [],
				changes: transaction.changes,
				oldContent,
				newContent,
				today: "2026-07-03",
				createdDay: "2026-07-03",
				enabled: true,
			}),
		).toEqual([]);
	});

	it("does not record checkbox checks when disabled", () => {
		const oldContent = "- [ ] task text";
		const newContent = "- [x] task text";
		const transaction = edit(oldContent, { from: 3, to: 4, insert: "x" });

		expect(
			applyTaskCompletionChanges({
				completions: [],
				changes: transaction.changes,
				oldContent,
				newContent,
				today: "2026-07-05",
				createdDay: "2026-07-03",
				enabled: false,
			}),
		).toEqual([]);
	});

	it("removes the task completion record when a checkbox is unchecked", () => {
		const oldContent = "- [x] task text";
		const newContent = "- [ ] task text";
		const transaction = edit(oldContent, { from: 3, to: 4, insert: " " });

		expect(
			applyTaskCompletionChanges({
				completions: [{ from: 3, to: 4, day: "2026-07-04" }],
				changes: transaction.changes,
				oldContent,
				newContent,
				today: "2026-07-05",
				createdDay: "2026-07-03",
				enabled: true,
			}),
		).toEqual([]);
	});

	it("maps task completion records through edits before the task", () => {
		const oldContent = "- [x] task text";
		const newContent = "Intro\n- [x] task text";
		const transaction = edit(oldContent, { from: 0, insert: "Intro\n" });

		expect(
			applyTaskCompletionChanges({
				completions: [{ from: 3, to: 4, day: "2026-07-04" }],
				changes: transaction.changes,
				oldContent,
				newContent,
				today: "2026-07-05",
				createdDay: "2026-07-03",
				enabled: true,
			}),
		).toEqual([{ from: 9, to: 10, day: "2026-07-04" }]);
	});

	it("derives the visible task text range from the checkbox marker", () => {
		const content = "- [x] task **text**";
		expect(
			taskCompletionTextRanges(content, [
				{ from: 3, to: 4, day: "2026-07-05" },
			]),
		).toEqual([
			{ from: 6, to: 11, day: "2026-07-05", markerFrom: 3 },
			{ from: 13, to: 17, day: "2026-07-05", markerFrom: 3 },
		]);
	});

	it("derives the completed task line from the checkbox marker", () => {
		const content = "Intro\n- [x] task text";
		expect(
			taskCompletionLineRanges(content, [
				{ from: 9, to: 10, day: "2026-07-05" },
			]),
		).toEqual([{ from: 6, to: 21, day: "2026-07-05", markerFrom: 9 }]);
	});
});
