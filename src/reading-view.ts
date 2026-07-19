import { setTooltip, type MarkdownPostProcessorContext } from "obsidian";
import { formatAnnotationDay } from "./core/dates";
import { taskCompletionTextRanges } from "./core/tasks";
import type { DaymarkStore } from "./store";

interface TextNodeIndex {
	node: Text;
	start: number;
	end: number;
}

interface WrapOperation {
	node: Text;
	nodeOrder: number;
	from: number;
	to: number;
	day: string;
	path: string;
	paletteIndex: number;
	className: string;
	description: string;
}

interface Token {
	text: string;
	day: string;
}

function lineOffset(content: string, lineNumber: number): number {
	let line = 0;
	let offset = 0;
	while (line < lineNumber && offset < content.length) {
		const newline = content.indexOf("\n", offset);
		if (newline < 0) {
			return content.length;
		}
		offset = newline + 1;
		line += 1;
	}
	return offset;
}

function collectTextNodes(root: HTMLElement): TextNodeIndex[] {
	const ownerDocument = root.ownerDocument;
	const walker = ownerDocument.createTreeWalker(root, 4);
	const nodes: TextNodeIndex[] = [];
	let combinedOffset = 0;
	let current = walker.nextNode();
	while (current) {
		const parent = current.parentElement;
		const text = current.textContent ?? "";
		if (
			parent &&
			text.length > 0 &&
			!parent.closest("code, pre, script, style, .frontmatter, .daymark-annotation")
		) {
			nodes.push({
				node: current as Text,
				start: combinedOffset,
				end: combinedOffset + text.length,
			});
			combinedOffset += text.length;
		}
		current = walker.nextNode();
	}
	return nodes;
}

function combinedText(nodes: readonly TextNodeIndex[]): string {
	return nodes.map((entry) => entry.node.data).join("");
}

function tokensFromRanges(
	content: string,
	sectionFrom: number,
	sectionTo: number,
	ranges: ReadonlyArray<{ from: number; to: number; day: string }>,
): Token[] {
	const tokens: Token[] = [];
	for (const range of ranges) {
		const overlapFrom = Math.max(sectionFrom, range.from);
		const overlapTo = Math.min(sectionTo, range.to);
		if (overlapFrom >= overlapTo) {
			continue;
		}
		const text = content.slice(overlapFrom, overlapTo);
		for (const token of text.match(/\S+/g) ?? []) {
			tokens.push({ text: token, day: range.day });
		}
	}
	return tokens;
}

function wrapOperation(operation: WrapOperation, store: DaymarkStore): void {
	const parent = operation.node.parentElement;
	if (!parent) {
		return;
	}
	const marked = operation.node.splitText(operation.from);
	if (operation.to - operation.from < marked.length) {
		marked.splitText(operation.to - operation.from);
	}
	const wrapper = parent.createSpan({
		cls: operation.className,
		attr: {
			"data-daymark-date": operation.day,
			"data-daymark-path": operation.path,
			"data-daymark-color-index": String(operation.paletteIndex),
			"data-daymark-tooltip": operation.description,
			"aria-description": operation.description,
		},
	});
	const colors = store.paletteColorsAt(operation.paletteIndex);
	wrapper.setCssProps({
		"--daymark-light-color": colors.light,
		"--daymark-dark-color": colors.dark,
	});
	parent.insertBefore(wrapper, marked);
	wrapper.appendChild(marked);
	if (operation.className === "daymark-task-completion") {
		const taskContainer = wrapper.closest<HTMLElement>(
			".task-list-item, li[data-task]",
		);
		taskContainer?.addClass("daymark-task-completion-line");
		taskContainer?.setCssProps({
			"--daymark-light-color": colors.light,
			"--daymark-dark-color": colors.dark,
		});
		taskContainer?.setAttrs({
			"data-daymark-date": operation.day,
			"data-daymark-path": operation.path,
			"data-daymark-color-index": String(operation.paletteIndex),
			"data-daymark-tooltip": operation.description,
		});
	}
	if (store.shouldShowAnnotationTooltip(operation.day)) {
		setTooltip(wrapper, operation.description, {
			placement: "top",
			delay: 150,
			classes: ["daymark-tooltip"],
		});
	}
}

function renderTokenWrappers(options: {
	element: HTMLElement;
	tokens: readonly Token[];
	path: string;
	className: string;
	descriptionPrefix: string;
	store: DaymarkStore;
}): void {
	if (options.tokens.length === 0) {
		return;
	}

	const nodes = collectTextNodes(options.element);
	const renderedText = combinedText(nodes);
	const operations: WrapOperation[] = [];
	let searchFrom = 0;

	for (const token of options.tokens) {
		let foundAt = renderedText.indexOf(token.text, searchFrom);
		if (foundAt < 0) {
			foundAt = renderedText.indexOf(token.text);
		}
		if (foundAt < 0) {
			continue;
		}
		const foundEnd = foundAt + token.text.length;
		nodes.forEach((entry, nodeOrder) => {
			const overlapFrom = Math.max(foundAt, entry.start);
			const overlapTo = Math.min(foundEnd, entry.end);
			if (overlapFrom < overlapTo) {
				operations.push({
					node: entry.node,
					nodeOrder,
					from: overlapFrom - entry.start,
					to: overlapTo - entry.start,
					day: token.day,
					path: options.path,
					paletteIndex: options.store.paletteIndex(options.path, token.day),
					className: options.className,
					description: `${options.descriptionPrefix} ${formatAnnotationDay(token.day)}`,
				});
			}
		});
		searchFrom = foundEnd;
	}

	operations
		.sort((left, right) => right.nodeOrder - left.nodeOrder || right.from - left.from)
		.forEach((operation) => wrapOperation(operation, options.store));
}

export function renderReadingAnnotations(
	element: HTMLElement,
	context: MarkdownPostProcessorContext,
	store: DaymarkStore,
	displayEnabled: boolean,
	sourceContent: string,
): void {
	if (!displayEnabled) {
		return;
	}
	const history = store.getRecord(context.sourcePath);
	const section = context.getSectionInfo(element);
	if (
		!history ||
		!section ||
		(history.spans.length === 0 && history.taskCompletions.length === 0)
	) {
		return;
	}

	const sectionFrom = lineOffset(sourceContent, section.lineStart);
	const sectionTo =
		section.lineEnd >= section.lineStart
			? lineOffset(sourceContent, section.lineEnd + 1)
			: sectionFrom + section.text.length;
	const safeSectionTo = Math.min(sourceContent.length, sectionTo);
	if (store.colorCheckedTasks()) {
		renderTokenWrappers({
			element,
			tokens: tokensFromRanges(
				sourceContent,
				sectionFrom,
				safeSectionTo,
				taskCompletionTextRanges(sourceContent, history.taskCompletions),
			),
			path: context.sourcePath,
			className: "daymark-task-completion",
			descriptionPrefix: "Checked on",
			store,
		});
	}

	renderTokenWrappers({
		element,
		tokens: tokensFromRanges(
			sourceContent,
			sectionFrom,
			safeSectionTo,
			history.spans,
		),
		path: context.sourcePath,
		className: "daymark-annotation",
		descriptionPrefix: "Added on",
		store,
	});
}
