import DiffMatchPatch from "diff-match-patch";
import { isAfterDay } from "./dates";
import { visibleProseRanges } from "./markdown";
import { normalizeSpans } from "./ranges";
import { normalizeTaskCompletions } from "./tasks";
import type { AnnotationSpan, TaskCompletion } from "../types";

const DIFF_DELETE = -1;
const DIFF_EQUAL = 0;
const DIFF_INSERT = 1;

export function reconcileContent(options: {
	oldContent: string;
	newContent: string;
	spans: readonly AnnotationSpan[];
	today: string;
	createdDay: string;
}): AnnotationSpan[] {
	const differ = new DiffMatchPatch();
	differ.Diff_Timeout = 0.5;
	const diffs = differ.diff_main(options.oldContent, options.newContent, true);
	differ.diff_cleanupEfficiency(diffs);

	let oldPosition = 0;
	let newPosition = 0;
	const mapped: AnnotationSpan[] = [];
	let reconstructed = "";

	for (const [operation, text] of diffs) {
		if (operation === DIFF_EQUAL) {
			const oldEnd = oldPosition + text.length;
			for (const span of options.spans) {
				const overlapFrom = Math.max(span.from, oldPosition);
				const overlapTo = Math.min(span.to, oldEnd);
				if (overlapFrom < overlapTo) {
					mapped.push({
						from: newPosition + overlapFrom - oldPosition,
						to: newPosition + overlapTo - oldPosition,
						day: span.day,
					});
				}
			}
			oldPosition = oldEnd;
			newPosition += text.length;
			reconstructed += text;
		} else if (operation === DIFF_DELETE) {
			oldPosition += text.length;
		} else if (operation === DIFF_INSERT) {
			if (isAfterDay(options.today, options.createdDay)) {
				for (const range of visibleProseRanges(
					options.newContent,
					newPosition,
					newPosition + text.length,
				)) {
					mapped.push({ ...range, day: options.today });
				}
			}
			newPosition += text.length;
			reconstructed += text;
		}
	}

	if (reconstructed !== options.newContent) {
		throw new Error("External edit reconciliation produced an invalid document map.");
	}

	return normalizeSpans(mapped, options.newContent.length);
}

export function reconcileTaskCompletions(options: {
	oldContent: string;
	newContent: string;
	completions: readonly TaskCompletion[];
}): TaskCompletion[] {
	const differ = new DiffMatchPatch();
	differ.Diff_Timeout = 0.5;
	const diffs = differ.diff_main(options.oldContent, options.newContent, true);
	differ.diff_cleanupEfficiency(diffs);

	let oldPosition = 0;
	let newPosition = 0;
	const mapped: TaskCompletion[] = [];
	let reconstructed = "";

	for (const [operation, text] of diffs) {
		if (operation === DIFF_EQUAL) {
			const oldEnd = oldPosition + text.length;
			for (const completion of options.completions) {
				const overlapFrom = Math.max(completion.from, oldPosition);
				const overlapTo = Math.min(completion.to, oldEnd);
				if (overlapFrom < overlapTo) {
					mapped.push({
						from: newPosition + overlapFrom - oldPosition,
						to: newPosition + overlapTo - oldPosition,
						day: completion.day,
					});
				}
			}
			oldPosition = oldEnd;
			newPosition += text.length;
			reconstructed += text;
		} else if (operation === DIFF_DELETE) {
			oldPosition += text.length;
		} else if (operation === DIFF_INSERT) {
			newPosition += text.length;
			reconstructed += text;
		}
	}

	if (reconstructed !== options.newContent) {
		throw new Error("External task reconciliation produced an invalid document map.");
	}

	return normalizeTaskCompletions(mapped, options.newContent);
}
