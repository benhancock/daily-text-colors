import type { AnnotationSpan } from "../types";

const CONTEXT_LENGTH = 32;

export function addTextAnchors(
	spans: readonly AnnotationSpan[],
	content: string,
): AnnotationSpan[] {
	return spans.map((span) => ({
		from: span.from,
		to: span.to,
		day: span.day,
		anchor: {
			exact: content.slice(span.from, span.to),
			prefix: content.slice(Math.max(0, span.from - CONTEXT_LENGTH), span.from),
			suffix: content.slice(span.to, span.to + CONTEXT_LENGTH),
			position: span.from,
		},
	}));
}
