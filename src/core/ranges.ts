import type { ChangeDesc, ChangeSet } from "@codemirror/state";
import { isAfterDay } from "./dates";
import { visibleProseRanges } from "./markdown";
import type { AnnotationSpan } from "../types";

const LEGACY_EXCLUDED_PUNCTUATION = new Set(["[", "]", "(", ")", "<", ">", "|"]);

export function normalizeSpans(spans: readonly AnnotationSpan[], documentLength = Number.MAX_SAFE_INTEGER): AnnotationSpan[] {
	const sorted = spans
		.map((span) => ({
			from: Math.max(0, Math.min(documentLength, span.from)),
			to: Math.max(0, Math.min(documentLength, span.to)),
			day: span.day,
		}))
		.filter((span) => span.from < span.to)
		.sort((left, right) => left.from - right.from || left.to - right.to || left.day.localeCompare(right.day));

	const normalized: AnnotationSpan[] = [];
	for (const span of sorted) {
		const previous = normalized.at(-1);
		if (previous && previous.day === span.day && span.from <= previous.to) {
			previous.to = Math.max(previous.to, span.to);
		} else {
			normalized.push({ ...span });
		}
	}
	return normalized;
}

export function mapSpansThroughChanges(
	spans: readonly AnnotationSpan[],
	changes: ChangeDesc,
): AnnotationSpan[] {
	const mapped: AnnotationSpan[] = [];
	changes.iterGaps((oldFrom, newFrom, length) => {
		const oldTo = oldFrom + length;
		for (const span of spans) {
			const overlapFrom = Math.max(span.from, oldFrom);
			const overlapTo = Math.min(span.to, oldTo);
			if (overlapFrom < overlapTo) {
				mapped.push({
					from: newFrom + overlapFrom - oldFrom,
					to: newFrom + overlapTo - oldFrom,
					day: span.day,
				});
			}
		}
	});
	return normalizeSpans(mapped, changes.newLength);
}

export function visibleAnnotationSpans(
	spans: readonly AnnotationSpan[],
	content: string,
): AnnotationSpan[] {
	const visibleRanges = visibleProseRanges(content);
	const visibleSpans: AnnotationSpan[] = [];
	for (const span of spans) {
		for (const visible of visibleRanges) {
			const from = Math.max(span.from, visible.from);
			const to = Math.min(span.to, visible.to);
			if (from < to) {
				visibleSpans.push({ from, to, day: span.day });
			}
		}
	}
	return normalizeSpans(visibleSpans, content.length);
}

interface ChangedRange {
	oldFrom: number;
	oldTo: number;
	newFrom: number;
	newTo: number;
	inserted: string;
	deleted: string;
}

function changedRanges(changes: ChangeSet, oldContent: string): ChangedRange[] {
	const ranges: ChangedRange[] = [];
	changes.iterChanges((oldFrom, oldTo, newFrom, newTo, inserted) => {
		ranges.push({
			oldFrom,
			oldTo,
			newFrom,
			newTo,
			inserted: inserted.toString(),
			deleted: oldContent.slice(oldFrom, oldTo),
		});
	});
	return ranges;
}

function movedSpans(
	spans: readonly AnnotationSpan[],
	source: ChangedRange,
	target: ChangedRange,
): AnnotationSpan[] {
	const moved: AnnotationSpan[] = [];
	for (const span of spans) {
		const overlapFrom = Math.max(span.from, source.oldFrom);
		const overlapTo = Math.min(span.to, source.oldTo);
		if (overlapFrom < overlapTo) {
			moved.push({
				from: target.newFrom + overlapFrom - source.oldFrom,
				to: target.newFrom + overlapTo - source.oldFrom,
				day: span.day,
			});
		}
	}
	return moved;
}

function commonAffixLengths(change: ChangedRange): { prefix: number; suffix: number } {
	const maximumPrefix = Math.min(change.deleted.length, change.inserted.length);
	let prefix = 0;
	while (
		prefix < maximumPrefix &&
		change.deleted[prefix] === change.inserted[prefix]
	) {
		prefix += 1;
	}

	const maximumSuffix = Math.min(
		change.deleted.length - prefix,
		change.inserted.length - prefix,
	);
	let suffix = 0;
	while (
		suffix < maximumSuffix &&
		change.deleted[change.deleted.length - suffix - 1] ===
			change.inserted[change.inserted.length - suffix - 1]
	) {
		suffix += 1;
	}
	return { prefix, suffix };
}

function mapReplacementSegment(
	spans: readonly AnnotationSpan[],
	oldFrom: number,
	oldTo: number,
	newFrom: number,
): AnnotationSpan[] {
	const mapped: AnnotationSpan[] = [];
	for (const span of spans) {
		const overlapFrom = Math.max(span.from, oldFrom);
		const overlapTo = Math.min(span.to, oldTo);
		if (overlapFrom < overlapTo) {
			mapped.push({
				from: newFrom + overlapFrom - oldFrom,
				to: newFrom + overlapTo - oldFrom,
				day: span.day,
			});
		}
	}
	return mapped;
}

export function applyDocumentChanges(options: {
	spans: readonly AnnotationSpan[];
	changes: ChangeSet;
	oldContent: string;
	newContent: string;
	today: string;
	createdDay: string;
	preserveMoves: boolean;
}): AnnotationSpan[] {
	const mapped = mapSpansThroughChanges(options.spans, options.changes);
	const ranges = changedRanges(options.changes, options.oldContent);
	const additions: AnnotationSpan[] = [];
	const usedMoveSources = new Set<number>();

	for (const target of ranges) {
		if (target.inserted.length === 0) {
			continue;
		}

		let preservedMove = false;
		if (options.preserveMoves) {
			const sourceIndex = ranges.findIndex(
				(source, index) =>
					!usedMoveSources.has(index) &&
					source.deleted.length > 0 &&
					source.deleted === target.inserted,
			);
			if (sourceIndex >= 0) {
				const source = ranges[sourceIndex];
				if (source) {
					additions.push(...movedSpans(options.spans, source, target));
					usedMoveSources.add(sourceIndex);
					preservedMove = true;
				}
			}
		}

		if (!preservedMove) {
			const { prefix, suffix } = commonAffixLengths(target);
			if (prefix > 0) {
				additions.push(
					...mapReplacementSegment(
						options.spans,
						target.oldFrom,
						target.oldFrom + prefix,
						target.newFrom,
					),
				);
			}
			if (suffix > 0) {
				additions.push(
					...mapReplacementSegment(
						options.spans,
						target.oldTo - suffix,
						target.oldTo,
						target.newTo - suffix,
					),
				);
			}

			if (isAfterDay(options.today, options.createdDay)) {
				const additionFrom = target.newFrom + prefix;
				const additionTo = target.newTo - suffix;
				for (const range of visibleProseRanges(
					options.newContent,
					additionFrom,
					additionTo,
				)) {
					if (/\S/u.test(options.newContent.slice(range.from, range.to))) {
						additions.push({ ...range, day: options.today });
					}
				}
			}
		}
	}

	return normalizeSpans([...mapped, ...additions], options.newContent.length);
}

export function countCharactersByDay(spans: readonly AnnotationSpan[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const span of spans) {
		counts.set(span.day, (counts.get(span.day) ?? 0) + span.to - span.from);
	}
	return counts;
}

export function includeAdjacentVisiblePunctuation(
	spans: readonly AnnotationSpan[],
	content: string,
): AnnotationSpan[] {
	const visible = new Uint8Array(content.length);
	for (const range of visibleProseRanges(content)) {
		visible.fill(1, range.from, range.to);
	}

	const expanded = spans.map((span) => {
		let from = span.from;
		let to = span.to;
		while (
			from > 0 &&
			visible[from - 1] === 1 &&
			LEGACY_EXCLUDED_PUNCTUATION.has(content[from - 1] ?? "")
		) {
			from -= 1;
		}
		while (
			to < content.length &&
			visible[to] === 1 &&
			LEGACY_EXCLUDED_PUNCTUATION.has(content[to] ?? "")
		) {
			to += 1;
		}
		return { from, to, day: span.day };
	});
	return normalizeSpans(expanded, content.length);
}
