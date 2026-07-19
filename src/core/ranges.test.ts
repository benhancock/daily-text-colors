import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
	applyDocumentChanges,
	includeAdjacentVisiblePunctuation,
	visibleAnnotationSpans,
} from "./ranges";
import type { AnnotationSpan } from "../types";

function edit(
	oldContent: string,
	changes: { from: number; to?: number; insert?: string } | Array<{ from: number; to?: number; insert?: string }>,
) {
	const state = EditorState.create({ doc: oldContent });
	return state.update({ changes });
}

describe("annotation range updates", () => {
	it("leaves creation-day insertions uncolored", () => {
		const transaction = edit("", { from: 0, insert: "Hello" });
		expect(
			applyDocumentChanges({
				spans: [],
				changes: transaction.changes,
				oldContent: "",
				newContent: "Hello",
				today: "2026-07-03",
				createdDay: "2026-07-03",
				preserveMoves: false,
			}),
		).toEqual([]);
	});

	it("colors the first historical insertion immediately", () => {
		const transaction = edit("Hello", { from: 5, insert: " world" });
		expect(
			applyDocumentChanges({
				spans: [],
				changes: transaction.changes,
				oldContent: "Hello",
				newContent: "Hello world",
				today: "2026-07-04",
				createdDay: "2026-07-03",
				preserveMoves: false,
			}),
		).toEqual([{ from: 5, to: 11, day: "2026-07-04" }]);
	});

	it("does not color the previous character when Enter rewrites an indented line end", () => {
		const transaction = edit("    example", {
			from: 10,
			to: 11,
			insert: "e\n    ",
		});
		expect(
			applyDocumentChanges({
				spans: [],
				changes: transaction.changes,
				oldContent: "    example",
				newContent: "    example\n    ",
				today: "2026-07-04",
				createdDay: "2026-07-03",
				preserveMoves: false,
			}),
		).toEqual([]);
	});

	it("ignores newline indentation and colors only text subsequently typed there", () => {
		const transaction = edit("    example\n    ", {
			from: 16,
			insert: "X",
		});
		expect(
			applyDocumentChanges({
				spans: [],
				changes: transaction.changes,
				oldContent: "    example\n    ",
				newContent: "    example\n    X",
				today: "2026-07-04",
				createdDay: "2026-07-03",
				preserveMoves: false,
			}),
		).toEqual([{ from: 16, to: 17, day: "2026-07-04" }]);
	});

	it("preserves annotation dates on unchanged replacement edges", () => {
		const transaction = edit("abcdef", {
			from: 1,
			to: 5,
			insert: "bcXde",
		});
		expect(
			applyDocumentChanges({
				spans: [{ from: 0, to: 6, day: "2026-07-04" }],
				changes: transaction.changes,
				oldContent: "abcdef",
				newContent: "abcXdef",
				today: "2026-07-05",
				createdDay: "2026-07-03",
				preserveMoves: false,
			}),
		).toEqual([
			{ from: 0, to: 3, day: "2026-07-04" },
			{ from: 3, to: 4, day: "2026-07-05" },
			{ from: 4, to: 7, day: "2026-07-04" },
		]);
	});

	it("splits an older range around a newer insertion", () => {
		const transaction = edit("abcdef", { from: 3, insert: "X" });
		const spans: AnnotationSpan[] = [{ from: 0, to: 6, day: "2026-07-04" }];
		expect(
			applyDocumentChanges({
				spans,
				changes: transaction.changes,
				oldContent: "abcdef",
				newContent: "abcXdef",
				today: "2026-07-05",
				createdDay: "2026-07-03",
				preserveMoves: false,
			}),
		).toEqual([
			{ from: 0, to: 3, day: "2026-07-04" },
			{ from: 3, to: 4, day: "2026-07-05" },
			{ from: 4, to: 7, day: "2026-07-04" },
		]);
	});

	it("preserves dates when annotated text is moved", () => {
		const transaction = edit("old new", [
			{ from: 0, to: 3, insert: "" },
			{ from: 7, insert: "old" },
		]);
		expect(
			applyDocumentChanges({
				spans: [{ from: 0, to: 3, day: "2026-07-04" }],
				changes: transaction.changes,
				oldContent: "old new",
				newContent: " newold",
				today: "2026-07-05",
				createdDay: "2026-07-03",
				preserveMoves: true,
			}),
		).toEqual([{ from: 4, to: 7, day: "2026-07-04" }]);
	});

	it("removes only the deleted part of an annotation", () => {
		const transaction = edit("abcdef", { from: 2, to: 4, insert: "" });
		expect(
			applyDocumentChanges({
				spans: [{ from: 0, to: 6, day: "2026-07-04" }],
				changes: transaction.changes,
				oldContent: "abcdef",
				newContent: "abef",
				today: "2026-07-05",
				createdDay: "2026-07-03",
				preserveMoves: false,
			}),
		).toEqual([{ from: 0, to: 4, day: "2026-07-04" }]);
	});

	it("does not annotate task checkbox marker changes", () => {
		const oldContent = "- [ ] task text";
		const newContent = "- [x] task text";
		const transaction = edit(oldContent, { from: 3, to: 4, insert: "x" });
		expect(
			applyDocumentChanges({
				spans: [{ from: 6, to: 15, day: "2026-07-04" }],
				changes: transaction.changes,
				oldContent,
				newContent,
				today: "2026-07-05",
				createdDay: "2026-07-03",
				preserveMoves: false,
			}),
		).toEqual([{ from: 6, to: 15, day: "2026-07-04" }]);
	});

	it("preserves annotations when an auto-paired bracket is removed", () => {
		const oldContent = "already annotated[]";
		const transaction = edit(oldContent, { from: 17, to: 19, insert: "" });
		expect(
			applyDocumentChanges({
				spans: [{ from: 0, to: 17, day: "2026-07-04" }],
				changes: transaction.changes,
				oldContent,
				newContent: "already annotated",
				today: "2026-07-05",
				createdDay: "2026-07-03",
				preserveMoves: false,
			}),
		).toEqual([{ from: 0, to: 17, day: "2026-07-04" }]);
	});

	it("treats a copied insertion as a new addition", () => {
		const transaction = edit("old", { from: 3, insert: "old" });
		expect(
			applyDocumentChanges({
				spans: [{ from: 0, to: 3, day: "2026-07-04" }],
				changes: transaction.changes,
				oldContent: "old",
				newContent: "oldold",
				today: "2026-07-05",
				createdDay: "2026-07-03",
				preserveMoves: false,
			}),
		).toEqual([
			{ from: 0, to: 3, day: "2026-07-04" },
			{ from: 3, to: 6, day: "2026-07-05" },
		]);
	});

	it("uses UTF-16 positions for emoji-containing text", () => {
		const transaction = edit("🙂", { from: 2, insert: "a" });
		expect(
			applyDocumentChanges({
				spans: [],
				changes: transaction.changes,
				oldContent: "🙂",
				newContent: "🙂a",
				today: "2026-07-04",
				createdDay: "2026-07-03",
				preserveMoves: false,
			}),
		).toEqual([{ from: 2, to: 3, day: "2026-07-04" }]);
	});

	it("migrates ordinary punctuation without coloring Markdown link syntax", () => {
		const content = "(hello) [label](destination) | tail";
		expect(
			includeAdjacentVisiblePunctuation(
				[
					{ from: 1, to: 6, day: "2026-07-04" },
					{ from: 9, to: 14, day: "2026-07-04" },
					{ from: 30, to: 34, day: "2026-07-04" },
				],
				content,
			),
		).toEqual([
			{ from: 0, to: 7, day: "2026-07-04" },
			{ from: 9, to: 14, day: "2026-07-04" },
			{ from: 29, to: 34, day: "2026-07-04" },
		]);
	});

	it("prunes existing annotation spans away from task marker syntax", () => {
		const content = "- [x] task text";
		expect(
			visibleAnnotationSpans(
				[{ from: 0, to: content.length, day: "2026-07-04" }],
				content,
			),
		).toEqual([{ from: 6, to: 15, day: "2026-07-04" }]);
	});
});
