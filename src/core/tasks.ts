import type { ChangeSet } from "@codemirror/state";
import { isAfterDay } from "./dates";
import { visibleProseRanges } from "./markdown";
import { mapSpansThroughChanges } from "./ranges";
import type { TaskCompletion } from "../types";

interface SourceRange {
	from: number;
	to: number;
}

interface ChangedRange {
	oldFrom: number;
	oldTo: number;
	newFrom: number;
	newTo: number;
	inserted: string;
	deleted: string;
}

interface TaskMarker {
	state: string;
	stateFrom: number;
	textFrom: number;
	line: SourceRange;
}

export interface TaskCompletionTextRange {
	from: number;
	to: number;
	day: string;
	markerFrom: number;
}

export interface TaskCompletionLineRange {
	from: number;
	to: number;
	day: string;
	markerFrom: number;
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

function lineRangeAt(content: string, position: number): SourceRange {
	const safePosition = Math.max(0, Math.min(content.length, position));
	const previousBreak = content.lastIndexOf("\n", Math.max(0, safePosition - 1));
	const nextBreak = content.indexOf("\n", safePosition);
	return {
		from: previousBreak < 0 ? 0 : previousBreak + 1,
		to: nextBreak < 0 ? content.length : nextBreak,
	};
}

function taskMarkerAtLine(content: string, line: SourceRange): TaskMarker | null {
	const text = content.slice(line.from, line.to);
	const match = /^(\s*(?:>\s*)*)((?:[-+*]|\d+[.)])\s+)\[([ xX])\](\s*)/u.exec(text);
	if (!match) {
		return null;
	}
	const blockquotePrefix = match[1] ?? "";
	const listPrefix = match[2] ?? "";
	const state = match[3] ?? "";
	const trailingSpace = match[4] ?? "";
	const stateFrom = line.from + blockquotePrefix.length + listPrefix.length + 1;
	return {
		state,
		stateFrom,
		textFrom:
			line.from +
			blockquotePrefix.length +
			listPrefix.length +
			"[x]".length +
			trailingSpace.length,
		line,
	};
}

function changeTouchesPosition(from: number, to: number, position: number): boolean {
	return from <= position + 1 && to >= position;
}

export function normalizeTaskCompletions(
	completions: readonly TaskCompletion[],
	content: string,
): TaskCompletion[] {
	const byPosition = new Map<number, TaskCompletion>();
	for (const completion of completions) {
		const line = lineRangeAt(content, completion.from);
		const marker = taskMarkerAtLine(content, line);
		if (
			!marker ||
			marker.state.toLowerCase() !== "x" ||
			completion.from > marker.stateFrom ||
			completion.to < marker.stateFrom + 1
		) {
			continue;
		}
		byPosition.set(marker.stateFrom, {
			from: marker.stateFrom,
			to: marker.stateFrom + 1,
			day: completion.day,
		});
	}
	return [...byPosition.values()].sort((left, right) => left.from - right.from);
}

export function mapTaskCompletionsThroughChanges(
	completions: readonly TaskCompletion[],
	changes: ChangeSet,
	newContent: string,
): TaskCompletion[] {
	return normalizeTaskCompletions(
		mapSpansThroughChanges(completions, changes).map((completion) => ({
			from: completion.from,
			to: completion.to,
			day: completion.day,
		})),
		newContent,
	);
}

export function checkedTaskCompletionsFromChanges(options: {
	changes: ChangeSet;
	oldContent: string;
	newContent: string;
	today: string;
	createdDay: string;
}): TaskCompletion[] {
	if (!isAfterDay(options.today, options.createdDay)) {
		return [];
	}
	const additions: TaskCompletion[] = [];
	const seen = new Set<number>();
	for (const change of changedRanges(options.changes, options.oldContent)) {
		const oldLine = lineRangeAt(options.oldContent, change.oldFrom);
		const newLine = lineRangeAt(options.newContent, change.newFrom);
		const oldMarker = taskMarkerAtLine(options.oldContent, oldLine);
		const newMarker = taskMarkerAtLine(options.newContent, newLine);
		if (
			!oldMarker ||
			!newMarker ||
			oldMarker.state !== " " ||
			newMarker.state.toLowerCase() !== "x" ||
			!changeTouchesPosition(change.oldFrom, change.oldTo, oldMarker.stateFrom) ||
			!changeTouchesPosition(change.newFrom, change.newTo, newMarker.stateFrom) ||
			seen.has(newMarker.stateFrom)
		) {
			continue;
		}
		seen.add(newMarker.stateFrom);
		additions.push({
			from: newMarker.stateFrom,
			to: newMarker.stateFrom + 1,
			day: options.today,
		});
	}
	return additions;
}

export function applyTaskCompletionChanges(options: {
	completions: readonly TaskCompletion[];
	changes: ChangeSet;
	oldContent: string;
	newContent: string;
	today: string;
	createdDay: string;
	enabled: boolean;
}): TaskCompletion[] {
	const mapped = mapTaskCompletionsThroughChanges(
		options.completions,
		options.changes,
		options.newContent,
	);
	const additions = options.enabled
		? checkedTaskCompletionsFromChanges(options)
		: [];
	return normalizeTaskCompletions([...mapped, ...additions], options.newContent);
}

export function taskCompletionTextRanges(
	content: string,
	completions: readonly TaskCompletion[],
): TaskCompletionTextRange[] {
	const ranges: TaskCompletionTextRange[] = [];
	for (const completion of normalizeTaskCompletions(completions, content)) {
		const line = lineRangeAt(content, completion.from);
		const marker = taskMarkerAtLine(content, line);
		if (!marker) {
			continue;
		}
		for (const range of visibleProseRanges(content, marker.textFrom, line.to)) {
			if (/\S/u.test(content.slice(range.from, range.to))) {
				ranges.push({
					...range,
					day: completion.day,
					markerFrom: marker.stateFrom,
				});
			}
		}
	}
	return ranges;
}

export function taskCompletionLineRanges(
	content: string,
	completions: readonly TaskCompletion[],
): TaskCompletionLineRange[] {
	const ranges: TaskCompletionLineRange[] = [];
	const seenLines = new Set<number>();
	for (const completion of normalizeTaskCompletions(completions, content)) {
		const line = lineRangeAt(content, completion.from);
		const marker = taskMarkerAtLine(content, line);
		if (!marker || seenLines.has(line.from)) {
			continue;
		}
		seenLines.add(line.from);
		ranges.push({
			from: line.from,
			to: line.to,
			day: completion.day,
			markerFrom: marker.stateFrom,
		});
	}
	return ranges;
}

export function countTaskCompletionsByDay(
	completions: readonly TaskCompletion[],
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const completion of completions) {
		counts.set(completion.day, (counts.get(completion.day) ?? 0) + 1);
	}
	return counts;
}
