interface SourceRange {
	from: number;
	to: number;
}

const MARKDOWN_DELIMITERS = new Set(["*", "_", "~", "`"]);

function markRange(excluded: Uint8Array, start: number, end: number): void {
	const safeStart = Math.max(0, start);
	const safeEnd = Math.min(excluded.length, end);
	for (let index = safeStart; index < safeEnd; index += 1) {
		excluded[index] = 1;
	}
}

function lineRanges(content: string): SourceRange[] {
	const ranges: SourceRange[] = [];
	let start = 0;
	for (let index = 0; index <= content.length; index += 1) {
		if (index === content.length || content[index] === "\n") {
			ranges.push({ from: start, to: index });
			start = index + 1;
		}
	}
	return ranges;
}

function excludeFrontmatter(content: string, excluded: Uint8Array, lines: SourceRange[]): void {
	if (lines.length === 0 || content.slice(lines[0]?.from, lines[0]?.to).trim() !== "---") {
		return;
	}
	for (let index = 1; index < lines.length; index += 1) {
		const line = lines[index];
		if (!line) {
			continue;
		}
		const text = content.slice(line.from, line.to).trim();
		if (text === "---" || text === "...") {
			markRange(excluded, 0, Math.min(content.length, line.to + 1));
			return;
		}
	}
}

function excludeFencedCode(content: string, excluded: Uint8Array, lines: SourceRange[]): void {
	let fence: string | null = null;
	let fenceStart = 0;
	for (const line of lines) {
		const text = content.slice(line.from, line.to);
		const match = /^\s*(`{3,}|~{3,})/.exec(text);
		if (!match?.[1]) {
			continue;
		}
		const marker = match[1].charAt(0);
		if (fence === null) {
			fence = marker;
			fenceStart = line.from;
		} else if (fence === marker) {
			markRange(excluded, fenceStart, Math.min(content.length, line.to + 1));
			fence = null;
		}
	}
	if (fence !== null) {
		markRange(excluded, fenceStart, content.length);
	}
}

function excludeLineSyntax(content: string, excluded: Uint8Array, lines: SourceRange[]): void {
	for (const line of lines) {
		const text = content.slice(line.from, line.to);
		const prefix =
			/^(\s*(?:>\s*)*)(?:(#{1,6}\s+)|((?:[-+*]|\d+[.)])\s+)(\[[ xX]\]\s*)?)?/.exec(
				text,
			);
		if (prefix) {
			const blockquotePrefix = prefix[1] ?? "";
			const headingPrefix = prefix[2] ?? "";
			const listPrefix = prefix[3] ?? "";
			const taskPrefix = prefix[4] ?? "";
			const hasBlockquote = blockquotePrefix.includes(">");
			const syntaxLength =
				hasBlockquote || headingPrefix.length > 0 || listPrefix.length > 0
					? blockquotePrefix.length +
						headingPrefix.length +
						listPrefix.length +
						taskPrefix.length
					: 0;
			if (syntaxLength > 0) {
				markRange(excluded, line.from, line.from + syntaxLength);
			}
		}

		const linkDestinationPattern = /!?\[([^\]]*)\]\(([^)]*)\)/g;
		let linkMatch: RegExpExecArray | null;
		while ((linkMatch = linkDestinationPattern.exec(text)) !== null) {
			const whole = linkMatch[0];
			const openingBracketOffset = whole.startsWith("!") ? 1 : 0;
			const closingBracketOffset = whole.indexOf("]");
			markRange(
				excluded,
				line.from + linkMatch.index,
				line.from + linkMatch.index + openingBracketOffset + 1,
			);
			markRange(
				excluded,
				line.from + linkMatch.index + closingBracketOffset,
				line.from + linkMatch.index + closingBracketOffset + 1,
			);
			markRange(
				excluded,
				line.from + linkMatch.index + closingBracketOffset + 1,
				line.from + linkMatch.index + whole.length,
			);
		}

		const referenceLinkPattern = /!?\[([^\]]*)\]\[([^\]]*)\]/g;
		let referenceMatch: RegExpExecArray | null;
		while ((referenceMatch = referenceLinkPattern.exec(text)) !== null) {
			const whole = referenceMatch[0];
			const openingBracketOffset = whole.startsWith("!") ? 1 : 0;
			const closingLabelOffset = whole.indexOf("]");
			markRange(
				excluded,
				line.from + referenceMatch.index,
				line.from + referenceMatch.index + openingBracketOffset + 1,
			);
			markRange(
				excluded,
				line.from + referenceMatch.index + closingLabelOffset,
				line.from + referenceMatch.index + whole.length,
			);
		}

		const wikiPattern = /\[\[([^\]]*)\]\]/g;
		let wikiMatch: RegExpExecArray | null;
		while ((wikiMatch = wikiPattern.exec(text)) !== null) {
			const whole = wikiMatch[0];
			const inner = wikiMatch[1] ?? "";
			const pipe = inner.indexOf("|");
			markRange(excluded, line.from + wikiMatch.index, line.from + wikiMatch.index + 2);
			markRange(
				excluded,
				line.from + wikiMatch.index + whole.length - 2,
				line.from + wikiMatch.index + whole.length,
			);
			if (pipe >= 0) {
				markRange(
					excluded,
					line.from + wikiMatch.index + 2,
					line.from + wikiMatch.index + 2 + pipe + 1,
				);
			}
		}

		const autoLinkPattern = /<(?:https?:\/\/|mailto:)[^>]+>/g;
		let autoLinkMatch: RegExpExecArray | null;
		while ((autoLinkMatch = autoLinkPattern.exec(text)) !== null) {
			markRange(
				excluded,
				line.from + autoLinkMatch.index,
				line.from + autoLinkMatch.index + 1,
			);
			markRange(
				excluded,
				line.from + autoLinkMatch.index + autoLinkMatch[0].length - 1,
				line.from + autoLinkMatch.index + autoLinkMatch[0].length,
			);
		}
	}
}

function excludeInlineCode(content: string, excluded: Uint8Array): void {
	let index = 0;
	while (index < content.length) {
		if (excluded[index] === 1 || content[index] !== "`") {
			index += 1;
			continue;
		}
		let runLength = 1;
		while (content[index + runLength] === "`") {
			runLength += 1;
		}
		const delimiter = "`".repeat(runLength);
		const closing = content.indexOf(delimiter, index + runLength);
		if (closing < 0) {
			markRange(excluded, index, index + runLength);
			index += runLength;
			continue;
		}
		markRange(excluded, index, closing + runLength);
		index = closing + runLength;
	}
}

export function visibleProseRanges(content: string, from = 0, to = content.length): SourceRange[] {
	const excluded = new Uint8Array(content.length);
	const lines = lineRanges(content);
	excludeFrontmatter(content, excluded, lines);
	excludeFencedCode(content, excluded, lines);
	excludeLineSyntax(content, excluded, lines);
	excludeInlineCode(content, excluded);

	const safeFrom = Math.max(0, from);
	const safeTo = Math.min(content.length, to);
	const ranges: SourceRange[] = [];
	let rangeStart: number | null = null;

	for (let index = safeFrom; index < safeTo; index += 1) {
		const character = content[index] ?? "";
		const visible =
			excluded[index] === 0 &&
			character !== "\n" &&
			character !== "\r" &&
			!MARKDOWN_DELIMITERS.has(character);

		if (visible && rangeStart === null) {
			rangeStart = index;
		} else if (!visible && rangeStart !== null) {
			ranges.push({ from: rangeStart, to: index });
			rangeStart = null;
		}
	}

	if (rangeStart !== null) {
		ranges.push({ from: rangeStart, to: safeTo });
	}
	return ranges;
}
