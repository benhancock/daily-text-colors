export interface PalettePair {
	light: string[];
	dark: string[];
}

export type PaletteMode = "ordered" | "random";

export interface PalettePreset {
	id: string;
	name: string;
	description: string;
	light: readonly string[];
	dark: readonly string[];
}

export const DEFAULT_DARK_PALETTE = [
	"#d14d41",
	"#da702c",
	"#d0a215",
	"#879a39",
	"#3aa99f",
	"#4385be",
	"#8b7ec8",
	"#ce5d97",
	"#66a0c8",
	"#a699d0",
	"#ec8b49",
	"#5abdac",
] as const;

export const DEFAULT_LIGHT_PALETTE = [
	"#af3029",
	"#bc5215",
	"#ad8301",
	"#66800b",
	"#24837b",
	"#205ea6",
	"#5e409d",
	"#a02f6f",
	"#1a4f8c",
	"#4f3685",
	"#9d4310",
	"#1c6c66",
] as const;

export const LEGACY_BLUE_FIRST_PALETTE = [
	"#4385be",
	"#8b7ec8",
	"#ce5d97",
	"#da702c",
	"#d0a215",
	"#879a39",
	"#3aa99f",
	"#d14d41",
	"#66a0c8",
	"#a699d0",
	"#ec8b49",
	"#5abdac",
] as const;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const PALETTE_PRESETS: readonly PalettePreset[] = [
	{
		id: "flexoki",
		name: "Flexoki",
		description: "Balanced Flexoki colors across warm and cool hues.",
		light: DEFAULT_LIGHT_PALETTE,
		dark: DEFAULT_DARK_PALETTE,
	},
	{
		id: "warm",
		name: "Warm",
		description: "Reds, oranges, yellows, and pinks.",
		light: [
			"#af3029",
			"#bc5215",
			"#ad8301",
			"#9d4310",
			"#a02f6f",
			"#66800b",
		],
		dark: [
			"#d14d41",
			"#da702c",
			"#d0a215",
			"#ec8b49",
			"#ce5d97",
			"#879a39",
		],
	},
	{
		id: "cool",
		name: "Cool",
		description: "Blues, cyans, greens, and purples.",
		light: [
			"#205ea6",
			"#24837b",
			"#66800b",
			"#5e409d",
			"#1a4f8c",
			"#1c6c66",
			"#4f3685",
		],
		dark: [
			"#4385be",
			"#3aa99f",
			"#879a39",
			"#8b7ec8",
			"#66a0c8",
			"#5abdac",
			"#a699d0",
		],
	},
	{
		id: "sunset-gradient",
		name: "Sunset gradient",
		description: "A warm-to-cool gradient from red through violet.",
		light: [
			"#af3029",
			"#bc5215",
			"#ad8301",
			"#66800b",
			"#24837b",
			"#205ea6",
			"#5e409d",
			"#a02f6f",
		],
		dark: [
			"#d14d41",
			"#da702c",
			"#d0a215",
			"#879a39",
			"#3aa99f",
			"#4385be",
			"#8b7ec8",
			"#ce5d97",
		],
	},
	{
		id: "ocean-gradient",
		name: "Ocean gradient",
		description: "Teal and blue shades with a soft violet finish.",
		light: [
			"#1c6c66",
			"#24837b",
			"#205ea6",
			"#1a4f8c",
			"#4f3685",
			"#5e409d",
		],
		dark: [
			"#5abdac",
			"#3aa99f",
			"#4385be",
			"#66a0c8",
			"#a699d0",
			"#8b7ec8",
		],
	},
] as const;

function palettesMatch(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((color, index) => color === right[index]);
}

export function normalizePalette(
	value: unknown,
	fallback: readonly string[] = DEFAULT_DARK_PALETTE,
): string[] {
	if (!Array.isArray(value)) {
		return [...fallback];
	}
	const colors = value
		.filter((color): color is string => typeof color === "string" && HEX_COLOR.test(color))
		.map((color) => color.toLowerCase());
	return colors.length > 0 ? colors : [...fallback];
}

export function normalizeStoredPalette(value: unknown): string[] {
	const palette = normalizePalette(value);
	return palettesMatch(palette, LEGACY_BLUE_FIRST_PALETTE)
		? [...DEFAULT_DARK_PALETTE]
		: palette;
}

export function isLegacyBlueFirstPalette(value: unknown): boolean {
	if (!Array.isArray(value)) {
		return false;
	}
	return palettesMatch(
		value.filter((color): color is string => typeof color === "string")
			.map((color) => color.toLowerCase()),
		LEGACY_BLUE_FIRST_PALETTE,
	);
}

export function migrateLegacyPalette(value: unknown): PalettePair {
	const dark = normalizeStoredPalette(value);
	const light = palettesMatch(dark, DEFAULT_DARK_PALETTE)
		? [...DEFAULT_LIGHT_PALETTE]
		: [...dark];
	return { light, dark };
}

export function normalizePalettePair(lightValue: unknown, darkValue: unknown): PalettePair {
	const light = normalizePalette(lightValue, DEFAULT_LIGHT_PALETTE);
	const dark = normalizePalette(darkValue, DEFAULT_DARK_PALETTE);
	const length = Math.max(light.length, dark.length);
	for (let index = light.length; index < length; index += 1) {
		light.push(nextDefaultColors(index).light);
	}
	for (let index = dark.length; index < length; index += 1) {
		dark.push(nextDefaultColors(index).dark);
	}
	return { light, dark };
}

export function normalizePaletteMode(value: unknown): PaletteMode {
	return value === "random" ? "random" : "ordered";
}

export function palettePresetById(id: string): PalettePreset | null {
	return PALETTE_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function matchingPalettePreset(
	palettes: PalettePair,
): PalettePreset | null {
	return (
		PALETTE_PRESETS.find(
			(preset) =>
				palettesMatch(palettes.light, preset.light) &&
				palettesMatch(palettes.dark, preset.dark),
		) ?? null
	);
}

export function nextDefaultColors(index: number): { light: string; dark: string } {
	return {
		light:
			DEFAULT_LIGHT_PALETTE[index % DEFAULT_LIGHT_PALETTE.length] ??
			DEFAULT_LIGHT_PALETTE[0],
		dark:
			DEFAULT_DARK_PALETTE[index % DEFAULT_DARK_PALETTE.length] ??
			DEFAULT_DARK_PALETTE[0],
	};
}

export function resolvePaletteIndex(
	dayIndex: number,
	paletteLength: number,
	loops: boolean,
): number {
	const safeLength = Math.max(1, Math.trunc(paletteLength));
	const safeIndex = Math.max(0, Math.trunc(dayIndex));
	return loops
		? safeIndex % safeLength
		: Math.min(safeIndex, safeLength - 1);
}

export function resolveRandomPaletteIndex(
	seed: string,
	paletteLength: number,
): number {
	const safeLength = Math.max(1, Math.trunc(paletteLength));
	let hash = 0x811c9dc5;
	for (let index = 0; index < seed.length; index += 1) {
		hash ^= seed.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0) % safeLength;
}
