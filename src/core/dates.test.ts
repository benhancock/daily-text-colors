import { describe, expect, it } from "vitest";
import {
	formatAnnotationDay,
	isAfterDay,
	localDay,
	shouldShowAnnotationTooltip,
} from "./dates";

describe("calendar day handling", () => {
	it("formats local dates in sortable form", () => {
		expect(localDay(new Date(2026, 6, 3, 23, 59))).toBe("2026-07-03");
	});

	it("recognizes the next calendar day", () => {
		expect(isAfterDay("2026-07-04", "2026-07-03")).toBe(true);
		expect(isAfterDay("2026-07-03", "2026-07-03")).toBe(false);
	});

	it("formats annotation dates for tooltips", () => {
		expect(formatAnnotationDay("2026-07-03", "en-US")).toBe("Friday, July 3, 2026");
	});

	it("shows tooltips only for non-current dates", () => {
		expect(shouldShowAnnotationTooltip("2026-07-03", "2026-07-03")).toBe(false);
		expect(shouldShowAnnotationTooltip("2026-07-02", "2026-07-03")).toBe(true);
	});

	it("can show tooltips for the current day when enabled", () => {
		expect(shouldShowAnnotationTooltip("2026-07-03", "2026-07-03", true)).toBe(true);
	});
});
