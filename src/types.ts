import {
	DEFAULT_DARK_PALETTE,
	DEFAULT_LIGHT_PALETTE,
	type PaletteMode,
} from "./core/palette";

export interface AnnotationSpan {
	from: number;
	to: number;
	day: string;
	anchor?: TextAnchor;
}

export interface TaskCompletion {
	from: number;
	to: number;
	day: string;
}

export interface TextAnchor {
	exact: string;
	prefix: string;
	suffix: string;
	position: number;
}

export interface NoteHistory {
	path: string;
	createdDay: string;
	explicitBaseline: boolean;
	lastContent: string;
	contentHash: string;
	dayOrder: string[];
	spans: AnnotationSpan[];
	taskCompletions: TaskCompletion[];
}

export interface DailyTextColorsSettings {
	lightPalette: string[];
	darkPalette: string[];
	colorCycleLoops: boolean;
	paletteMode: PaletteMode;
	showAnnotationTooltips: boolean;
	showCurrentDayTooltips: boolean;
	colorCheckedTasks: boolean;
	useNativeInternalLinks: boolean;
	useNativeExternalLinks: boolean;
}

export interface DailyTextColorsData {
	schemaVersion: 7;
	settings: DailyTextColorsSettings;
	notes: Record<string, CachedNoteHistory>;
}

export interface CachedNoteHistory {
	path: string;
	sidecarId: string;
	createdDay: string;
	explicitBaseline: boolean;
	contentHash: string;
	dayOrder: string[];
	spans: AnnotationSpan[];
	taskCompletions: TaskCompletion[];
}

export interface DailyTextColorsSidecar {
	schemaVersion: 1;
	history: NoteHistory;
}

export const EMPTY_DAILY_TEXT_COLORS_DATA: DailyTextColorsData = {
	schemaVersion: 7,
	settings: {
		lightPalette: [...DEFAULT_LIGHT_PALETTE],
		darkPalette: [...DEFAULT_DARK_PALETTE],
		colorCycleLoops: true,
		paletteMode: "ordered",
		showAnnotationTooltips: true,
		showCurrentDayTooltips: false,
		colorCheckedTasks: false,
		useNativeInternalLinks: true,
		useNativeExternalLinks: true,
	},
	notes: {},
};
