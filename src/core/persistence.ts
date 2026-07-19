import type { NoteHistory } from "../types";

export function hasAnnotationHistory(history: NoteHistory): boolean {
	return (
		history.dayOrder.length > 0 ||
		history.spans.length > 0 ||
		history.taskCompletions.length > 0
	);
}

export function shouldPersistHistory(history: NoteHistory): boolean {
	return history.explicitBaseline || hasAnnotationHistory(history);
}

export function inferLegacyExplicitBaseline(
	history: NoteHistory,
	fileCreatedDay: string | null,
): boolean {
	return (
		!hasAnnotationHistory(history) &&
		(fileCreatedDay === null || history.createdDay !== fileCreatedDay)
	);
}
