import { describe, expect, it } from "vitest";
import {
	DEFAULT_DARK_PALETTE,
	DEFAULT_LIGHT_PALETTE,
	LEGACY_BLUE_FIRST_PALETTE,
	matchingPalettePreset,
	isLegacyBlueFirstPalette,
	migrateLegacyPalette,
	nextDefaultColors,
	normalizePaletteMode,
	normalizePalette,
	normalizePalettePair,
	normalizeStoredPalette,
	resolveRandomPaletteIndex,
	resolvePaletteIndex,
} from "./palette";

describe("palette configuration", () => {
	it("preserves valid user colors and normalizes their case", () => {
		expect(normalizePalette(["#AABBCC", "#123456"])).toEqual(["#aabbcc", "#123456"]);
	});

	it("falls back to the Flexoki defaults for invalid or empty data", () => {
		expect(normalizePalette([])).toEqual(DEFAULT_DARK_PALETTE);
		expect(normalizePalette(["red", 42])).toEqual(DEFAULT_DARK_PALETTE);
	});

	it("cycles through defaults when suggesting additional colors", () => {
		expect(nextDefaultColors(DEFAULT_DARK_PALETTE.length)).toEqual({
			light: DEFAULT_LIGHT_PALETTE[0],
			dark: DEFAULT_DARK_PALETTE[0],
		});
	});

	it("uses Flexoki red for the first annotation day", () => {
		expect(DEFAULT_DARK_PALETTE[0]).toBe("#d14d41");
		expect(DEFAULT_LIGHT_PALETTE[0]).toBe("#af3029");
	});

	it("migrates the former blue-first default without changing custom palettes", () => {
		expect(isLegacyBlueFirstPalette(LEGACY_BLUE_FIRST_PALETTE)).toBe(true);
		expect(normalizeStoredPalette(LEGACY_BLUE_FIRST_PALETTE)).toEqual(
			DEFAULT_DARK_PALETTE,
		);
		expect(normalizeStoredPalette(["#123456", "#abcdef"])).toEqual([
			"#123456",
			"#abcdef",
		]);
	});

	it("gives the former default distinct theme palettes while preserving custom colors", () => {
		expect(migrateLegacyPalette(DEFAULT_DARK_PALETTE)).toEqual({
			light: [...DEFAULT_LIGHT_PALETTE],
			dark: [...DEFAULT_DARK_PALETTE],
		});
		expect(migrateLegacyPalette(["#123456", "#abcdef"])).toEqual({
			light: ["#123456", "#abcdef"],
			dark: ["#123456", "#abcdef"],
		});
	});

	it("keeps light and dark palette lengths aligned", () => {
		const pair = normalizePalettePair(["#111111"], ["#222222", "#333333"]);
		expect(pair.light).toHaveLength(2);
		expect(pair.dark).toHaveLength(2);
		expect(pair.light[0]).toBe("#111111");
		expect(pair.dark).toEqual(["#222222", "#333333"]);
	});

	it("either loops the palette or holds on its final color", () => {
		expect(resolvePaletteIndex(13, 12, true)).toBe(1);
		expect(resolvePaletteIndex(13, 12, false)).toBe(11);
		expect(resolvePaletteIndex(2, 12, false)).toBe(2);
	});

	it("normalizes palette modes", () => {
		expect(normalizePaletteMode("random")).toBe("random");
		expect(normalizePaletteMode("ordered")).toBe("ordered");
		expect(normalizePaletteMode("surprise")).toBe("ordered");
	});

	it("matches the default preset from stored colors", () => {
		expect(
			matchingPalettePreset({
				light: [...DEFAULT_LIGHT_PALETTE],
				dark: [...DEFAULT_DARK_PALETTE],
			})?.id,
		).toBe("flexoki");
		expect(
			matchingPalettePreset({
				light: ["#111111"],
				dark: ["#222222"],
			}),
		).toBeNull();
	});

	it("chooses random palette indexes deterministically from a seed", () => {
		expect(resolveRandomPaletteIndex("note-a\u00002026-07-05", 6)).toBe(
			resolveRandomPaletteIndex("note-a\u00002026-07-05", 6),
		);
		expect(resolveRandomPaletteIndex("note-a\u00002026-07-05", 6)).toBeGreaterThanOrEqual(0);
		expect(resolveRandomPaletteIndex("note-a\u00002026-07-05", 6)).toBeLessThan(6);
	});
});
