import { invertedEffects } from "@codemirror/commands";
import {
	EditorState,
	StateEffect,
	StateField,
	Transaction,
	type ChangeSet,
	type Extension,
} from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";
import { editorInfoField, setTooltip } from "obsidian";
import { formatAnnotationDay, localDay } from "./core/dates";
import { contentHash } from "./core/hash";
import {
	applyDocumentChanges,
	mapSpansThroughChanges,
	visibleAnnotationSpans,
} from "./core/ranges";
import {
	applyTaskCompletionChanges,
	mapTaskCompletionsThroughChanges,
	normalizeTaskCompletions,
	taskCompletionLineRanges,
	taskCompletionTextRanges,
} from "./core/tasks";
import type { DaymarkStore } from "./store";
import type { AnnotationSpan, TaskCompletion } from "./types";

interface EditorAnnotationState {
	path: string | null;
	spans: AnnotationSpan[];
	taskCompletions: TaskCompletion[];
	decorations: DecorationSet;
}

interface AnnotationPayload {
	spans: AnnotationSpan[];
	taskCompletions: TaskCompletion[];
}

interface ReloadRequest {
	path: string | null;
}

export interface DaymarkEditorController {
	extension: Extension;
	refresh(path?: string): void;
}

const replaceAnnotations = StateEffect.define<AnnotationPayload>({
	map: (payload, changes) => ({
		spans: mapSpansThroughChanges(payload.spans, changes),
		taskCompletions: mapSpansThroughChanges(
			payload.taskCompletions,
			changes,
		).map((completion) => ({
			from: completion.from,
			to: completion.to,
			day: completion.day,
		})),
	}),
});

const reloadAnnotations = StateEffect.define<ReloadRequest>();
const MAX_GENERATED_CHANGE_RANGES = 4;
const MAX_GENERATED_CHANGED_CHARACTERS = 128;

function currentPath(state: EditorState): string | null {
	return state.field(editorInfoField, false)?.file?.path ?? null;
}

function isSmallGeneratedChange(changes: ChangeSet, oldLength: number): boolean {
	let rangeCount = 0;
	let changedCharacters = 0;
	let replacesWholeDocument = false;
	changes.iterChanges((oldFrom, oldTo, newFrom, newTo) => {
		rangeCount += 1;
		changedCharacters += oldTo - oldFrom + newTo - newFrom;
		if (oldLength > 0 && oldFrom === 0 && oldTo === oldLength) {
			replacesWholeDocument = true;
		}
	});
	return (
		rangeCount > 0 &&
		rangeCount <= MAX_GENERATED_CHANGE_RANGES &&
		changedCharacters <= MAX_GENERATED_CHANGED_CHARACTERS &&
		!replacesWholeDocument
	);
}

function shouldTrackDocumentChange(
	transaction: Transaction,
	oldLength: number,
): boolean {
	return (
		transaction.annotation(Transaction.userEvent) !== undefined ||
		isSmallGeneratedChange(transaction.changes, oldLength)
	);
}

export function createDaymarkEditorController(
	store: DaymarkStore,
	isDisplayEnabled: () => boolean,
): DaymarkEditorController {
	const editorViews = new Set<EditorView>();
	let annotationField: StateField<EditorAnnotationState>;

	const createDecorations = (
		path: string | null,
		spans: readonly AnnotationSpan[],
		taskCompletions: readonly TaskCompletion[],
		content: string,
	): DecorationSet => {
		if (!path || !isDisplayEnabled()) {
			return Decoration.none;
		}
		const annotationDecorations = spans.map((span) => {
			const paletteIndex = store.paletteIndex(path, span.day);
			return Decoration.mark({
				class: "daymark-annotation",
				attributes: {
					"data-daymark-date": span.day,
					"data-daymark-path": path,
					"data-daymark-color-index": String(paletteIndex),
					"data-daymark-tooltip": `Added on ${formatAnnotationDay(span.day)}`,
					"aria-description": `Added on ${formatAnnotationDay(span.day)}`,
				},
			}).range(span.from, span.to);
		});
		const taskDecorations = store.colorCheckedTasks()
			? taskCompletionTextRanges(content, taskCompletions).map((range) => {
					const paletteIndex = store.paletteIndex(path, range.day);
					return Decoration.mark({
						class: "daymark-task-completion",
						attributes: {
							"data-daymark-date": range.day,
							"data-daymark-path": path,
							"data-daymark-color-index": String(paletteIndex),
							"data-daymark-tooltip": `Checked on ${formatAnnotationDay(range.day)}`,
							"aria-description": `Checked on ${formatAnnotationDay(range.day)}`,
						},
					}).range(range.from, range.to);
				})
			: [];
		const taskLineDecorations = store.colorCheckedTasks()
			? taskCompletionLineRanges(content, taskCompletions).map((range) => {
					const paletteIndex = store.paletteIndex(path, range.day);
					return Decoration.line({
						class: "daymark-task-completion-line",
						attributes: {
							"data-daymark-date": range.day,
							"data-daymark-path": path,
							"data-daymark-color-index": String(paletteIndex),
							"data-daymark-tooltip": `Checked on ${formatAnnotationDay(range.day)}`,
							"aria-description": `Checked on ${formatAnnotationDay(range.day)}`,
						},
					}).range(range.from);
				})
			: [];
		return Decoration.set(
			[...annotationDecorations, ...taskDecorations, ...taskLineDecorations],
			true,
		);
	};

	const loadState = (state: EditorState): EditorAnnotationState => {
		const info = state.field(editorInfoField, false);
		const file = info?.file ?? null;
		if (!file) {
			return {
				path: null,
				spans: [],
				taskCompletions: [],
				decorations: Decoration.none,
			};
		}
		const content = state.doc.toString();
		const history = store.getRecord(file.path);
		if (!history || history.contentHash !== contentHash(content)) {
			return {
				path: file.path,
				spans: [],
				taskCompletions: [],
				decorations: Decoration.none,
			};
		}
		const spans = visibleAnnotationSpans(history.spans, content);
		const taskCompletions = normalizeTaskCompletions(
			history.taskCompletions,
			content,
		);
		return {
			path: file.path,
			spans,
			taskCompletions,
			decorations: createDecorations(
				file.path,
				spans,
				taskCompletions,
				content,
			),
		};
	};

	annotationField = StateField.define<EditorAnnotationState>({
		create: loadState,
		update: (value, transaction) => {
			const path = currentPath(transaction.state);
			const reloadRequested = transaction.effects.some(
				(effect) =>
					effect.is(reloadAnnotations) &&
					(effect.value.path === null || effect.value.path === path),
			);
			if (path !== value.path || reloadRequested) {
				return loadState(transaction.state);
			}

			let spans = value.spans;
			let taskCompletions = value.taskCompletions;
			const replacement = transaction.effects.find((effect) =>
				effect.is(replaceAnnotations),
			);
			if (replacement?.is(replaceAnnotations)) {
				spans = replacement.value.spans;
				taskCompletions = replacement.value.taskCompletions;
			} else if (transaction.docChanged) {
				if (transaction.annotation(Transaction.userEvent)) {
					spans = mapSpansThroughChanges(spans, transaction.changes);
					taskCompletions = mapTaskCompletionsThroughChanges(
						taskCompletions,
						transaction.changes,
						transaction.state.doc.toString(),
					);
				} else {
					return loadState(transaction.state);
				}
			}
			return {
				path,
				spans,
				taskCompletions,
				decorations: createDecorations(
					path,
					spans,
					taskCompletions,
					transaction.state.doc.toString(),
				),
			};
		},
		provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
	});

	const extendTransactions = EditorState.transactionExtender.of((transaction) => {
		if (
			!transaction.docChanged ||
			transaction.effects.some((effect) => effect.is(replaceAnnotations))
		) {
			return null;
		}
		const state = transaction.startState.field(annotationField, false);
		const path = state?.path;
		const nextPath = currentPath(transaction.state);
		const info = transaction.startState.field(editorInfoField, false);
		const file = info?.file ?? null;
		if (!state || !path || path !== nextPath || !file || store.isPaused(path)) {
			return null;
		}
		const oldContent = transaction.startState.doc.toString();
		if (!shouldTrackDocumentChange(transaction, oldContent.length)) {
			return null;
		}
		const history = store.ensureBaseline(file, oldContent);
		if (history.contentHash !== contentHash(oldContent)) {
			return null;
		}
		const newContent = transaction.newDoc.toString();
		const spans = applyDocumentChanges({
			spans: state.spans,
			changes: transaction.changes,
			oldContent,
			newContent,
			today: localDay(),
			createdDay: history.createdDay,
			preserveMoves: transaction.isUserEvent("move"),
		});
		const taskCompletions = applyTaskCompletionChanges({
			completions: state.taskCompletions,
			changes: transaction.changes,
			oldContent,
			newContent,
			today: localDay(),
			createdDay: history.createdDay,
			enabled: store.colorCheckedTasks(),
		});
		return {
			effects: replaceAnnotations.of({ spans, taskCompletions }),
		};
	});

	const invertSpanChanges = invertedEffects.of((transaction) => {
		if (!transaction.effects.some((effect) => effect.is(replaceAnnotations))) {
			return [];
		}
		const previous = transaction.startState.field(annotationField, false);
		return previous
			? [
					replaceAnnotations.of({
						spans: previous.spans,
						taskCompletions: previous.taskCompletions,
					}),
				]
			: [];
	});

	const persistUpdates = EditorView.updateListener.of((update: ViewUpdate) => {
		if (
			!update.transactions.some((transaction) =>
				transaction.effects.some((effect) => effect.is(replaceAnnotations)),
			)
		) {
			return;
		}
		const state = update.state.field(annotationField, false);
		if (state?.path) {
			store.commit(
				state.path,
				update.state.doc.toString(),
				state.spans,
				state.taskCompletions,
			);
		}
	});

	const trackEditors = ViewPlugin.fromClass(
		class DaymarkEditorTracker {
			constructor(readonly view: EditorView) {
				editorViews.add(view);
				this.bindTooltips();
			}

			update(): void {
				this.bindTooltips();
			}

			destroy(): void {
				editorViews.delete(this.view);
			}

			private bindTooltips(): void {
				this.view.requestMeasure({
					read: (view) =>
						Array.from(
							view.dom.querySelectorAll<HTMLElement>(
								".daymark-annotation, .daymark-task-completion, .daymark-task-completion-line",
							),
						),
					write: (elements) => {
						for (const element of elements) {
							const day = element.dataset.daymarkDate;
							const colorIndex = Number(element.dataset.daymarkColorIndex);
							if (Number.isInteger(colorIndex)) {
								const colors = store.paletteColorsAt(colorIndex);
								element.setCssProps({
									"--daymark-light-color": colors.light,
									"--daymark-dark-color": colors.dark,
								});
							}
							if (!day || !store.shouldShowAnnotationTooltip(day)) {
								continue;
							}
							if (element.hasClass("daymark-tooltip-bound")) {
								continue;
							}
							setTooltip(
								element,
								element.dataset.daymarkTooltip ??
									`Added on ${formatAnnotationDay(day)}`,
								{
									placement: "top",
									delay: 150,
									classes: ["daymark-tooltip"],
								},
							);
							element.addClass("daymark-tooltip-bound");
						}
					},
				});
			}
		},
	);

	return {
		extension: [
			annotationField,
			extendTransactions,
			invertSpanChanges,
			persistUpdates,
			trackEditors,
		],
		refresh: (path?: string) => {
			for (const view of editorViews) {
				view.dispatch({
					effects: reloadAnnotations.of({ path: path ?? null }),
					annotations: Transaction.addToHistory.of(false),
				});
			}
		},
	};
}
