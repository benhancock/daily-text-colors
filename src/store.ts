import { normalizePath, Plugin, TFile } from "obsidian";
import { addTextAnchors } from "./core/anchors";
import { localDay } from "./core/dates";
import { contentHash } from "./core/hash";
import {
	type PalettePair,
	type PaletteMode,
	migrateLegacyPalette,
	normalizePaletteMode,
	normalizePalettePair,
	resolvePaletteIndex,
	resolveRandomPaletteIndex,
} from "./core/palette";
import {
	inferLegacyExplicitBaseline,
	shouldPersistHistory,
} from "./core/persistence";
import { reconcileContent, reconcileTaskCompletions } from "./core/reconcile";
import {
	includeAdjacentVisiblePunctuation,
	normalizeSpans,
	visibleAnnotationSpans,
} from "./core/ranges";
import { normalizeTaskCompletions } from "./core/tasks";
import {
	EMPTY_DAYMARK_DATA,
	type AnnotationSpan,
	type CachedNoteHistory,
	type DaymarkData,
	type DaymarkSettings,
	type DaymarkSidecar,
	type NoteHistory,
	type TaskCompletion,
	type TextAnchor,
} from "./types";

const SIDECAR_ROOT = normalizePath(".daymark");
const SIDECAR_NOTES = normalizePath(`${SIDECAR_ROOT}/notes`);
const SIDECAR_SAVE_DELAY = 1_500;
const INDEX_CACHE_SAVE_DELAY = 30_000;
const SETTINGS_SAVE_DELAY = 500;

type ReconciliationFailureHandler = (path: string) => void;

interface LegacyData {
	schemaVersion: number;
	settings: DaymarkSettings;
	notes: Record<string, NoteHistory>;
}

function isTextAnchor(value: unknown): value is TextAnchor {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const candidate = value as Partial<TextAnchor>;
	return (
		typeof candidate.exact === "string" &&
		typeof candidate.prefix === "string" &&
		typeof candidate.suffix === "string" &&
		typeof candidate.position === "number"
	);
}

function isAnnotationSpan(value: unknown): value is AnnotationSpan {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const candidate = value as Partial<AnnotationSpan>;
	return (
		typeof candidate.from === "number" &&
		typeof candidate.to === "number" &&
		typeof candidate.day === "string" &&
		(candidate.anchor === undefined || isTextAnchor(candidate.anchor))
	);
}

function isTaskCompletion(value: unknown): value is TaskCompletion {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const candidate = value as Partial<TaskCompletion>;
	return (
		typeof candidate.from === "number" &&
		typeof candidate.to === "number" &&
		typeof candidate.day === "string"
	);
}

function isLegacyHistory(value: unknown): value is NoteHistory {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const candidate = value as Partial<NoteHistory>;
	return (
		typeof candidate.path === "string" &&
		typeof candidate.createdDay === "string" &&
		typeof candidate.lastContent === "string" &&
		typeof candidate.contentHash === "string" &&
		Array.isArray(candidate.dayOrder) &&
		candidate.dayOrder.every((day) => typeof day === "string") &&
		Array.isArray(candidate.spans) &&
		candidate.spans.every(isAnnotationSpan) &&
		(candidate.taskCompletions === undefined ||
			(Array.isArray(candidate.taskCompletions) &&
				candidate.taskCompletions.every(isTaskCompletion)))
	);
}

function isCachedHistory(value: unknown): value is CachedNoteHistory {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const candidate = value as Partial<CachedNoteHistory>;
	return (
		typeof candidate.path === "string" &&
		typeof candidate.sidecarId === "string" &&
		typeof candidate.createdDay === "string" &&
		typeof candidate.explicitBaseline === "boolean" &&
		typeof candidate.contentHash === "string" &&
		Array.isArray(candidate.dayOrder) &&
		candidate.dayOrder.every((day) => typeof day === "string") &&
		Array.isArray(candidate.spans) &&
		candidate.spans.every(isAnnotationSpan) &&
		(candidate.taskCompletions === undefined ||
			(Array.isArray(candidate.taskCompletions) &&
				candidate.taskCompletions.every(isTaskCompletion)))
	);
}

function settingsFrom(
	settingsValue: unknown,
	schemaVersion: number,
): DaymarkSettings {
	const settings =
		typeof settingsValue === "object" && settingsValue !== null
			? (settingsValue as {
					palette?: unknown;
					lightPalette?: unknown;
					darkPalette?: unknown;
					colorCycleLoops?: unknown;
					paletteMode?: unknown;
					showAnnotationTooltips?: unknown;
					showCurrentDayTooltips?: unknown;
					colorCheckedTasks?: unknown;
					useNativeInternalLinks?: unknown;
					useNativeExternalLinks?: unknown;
				})
			: null;
	const palettes =
		schemaVersion >= 3
			? normalizePalettePair(settings?.lightPalette, settings?.darkPalette)
			: migrateLegacyPalette(settings?.palette);
	return {
		lightPalette: palettes.light,
		darkPalette: palettes.dark,
		colorCycleLoops:
			typeof settings?.colorCycleLoops === "boolean"
				? settings.colorCycleLoops
				: true,
		paletteMode: normalizePaletteMode(settings?.paletteMode),
		showAnnotationTooltips:
			typeof settings?.showAnnotationTooltips === "boolean"
				? settings.showAnnotationTooltips
				: true,
		showCurrentDayTooltips:
			typeof settings?.showCurrentDayTooltips === "boolean"
				? settings.showCurrentDayTooltips
				: false,
		colorCheckedTasks:
			typeof settings?.colorCheckedTasks === "boolean"
				? settings.colorCheckedTasks
				: false,
		useNativeInternalLinks:
			typeof settings?.useNativeInternalLinks === "boolean"
				? settings.useNativeInternalLinks
				: true,
		useNativeExternalLinks:
			typeof settings?.useNativeExternalLinks === "boolean"
				? settings.useNativeExternalLinks
				: true,
	};
}

function parseCurrentData(value: unknown): DaymarkData | null {
	if (typeof value !== "object" || value === null) {
		return null;
	}
	const candidate = value as {
		schemaVersion?: unknown;
		settings?: unknown;
		notes?: unknown;
	};
	if (
		(candidate.schemaVersion !== 6 && candidate.schemaVersion !== 7) ||
		typeof candidate.notes !== "object" ||
		candidate.notes === null
	) {
		return null;
	}
	const notes: Record<string, CachedNoteHistory> = {};
	for (const [path, history] of Object.entries(candidate.notes)) {
		if (isCachedHistory(history)) {
			notes[path] = {
				...history,
				path,
				dayOrder: [...history.dayOrder],
				spans: history.spans.map((span) => ({
					...span,
					anchor: span.anchor ? { ...span.anchor } : undefined,
				})),
				taskCompletions: (history.taskCompletions ?? []).map((completion) => ({
					...completion,
				})),
			};
		}
	}
	return {
		schemaVersion: 7,
		settings: settingsFrom(candidate.settings, candidate.schemaVersion),
		notes,
	};
}

function parseLegacyData(value: unknown): LegacyData | null {
	if (typeof value !== "object" || value === null) {
		return null;
	}
	const candidate = value as {
		schemaVersion?: unknown;
		settings?: unknown;
		notes?: unknown;
	};
	if (
		(candidate.schemaVersion !== 1 &&
			candidate.schemaVersion !== 2 &&
			candidate.schemaVersion !== 3 &&
			candidate.schemaVersion !== 4 &&
			candidate.schemaVersion !== 5) ||
		typeof candidate.notes !== "object" ||
		candidate.notes === null
	) {
		return null;
	}
	const notes: Record<string, NoteHistory> = {};
	for (const [path, history] of Object.entries(candidate.notes)) {
		if (isLegacyHistory(history)) {
			notes[path] = {
				...history,
				path,
				explicitBaseline:
					candidate.schemaVersion === 5 &&
					typeof history.explicitBaseline === "boolean"
						? history.explicitBaseline
						: false,
				dayOrder: [...history.dayOrder],
				spans: includeAdjacentVisiblePunctuation(
					normalizeSpans(history.spans, history.lastContent.length),
					history.lastContent,
				),
				taskCompletions: [],
			};
		}
	}
	return {
		schemaVersion: candidate.schemaVersion,
		settings: settingsFrom(candidate.settings, candidate.schemaVersion),
		notes,
	};
}

function parseSidecar(value: unknown): DaymarkSidecar | null {
	if (typeof value !== "object" || value === null) {
		return null;
	}
	const candidate = value as Partial<DaymarkSidecar>;
	if (candidate.schemaVersion !== 1 || !isLegacyHistory(candidate.history)) {
		return null;
	}
	return {
		schemaVersion: 1,
		history: {
			...candidate.history,
			explicitBaseline: candidate.history.explicitBaseline === true,
			dayOrder: [...candidate.history.dayOrder],
			spans: candidate.history.spans.map((span) => ({
				...span,
				anchor: span.anchor ? { ...span.anchor } : undefined,
			})),
			taskCompletions: (candidate.history.taskCompletions ?? []).map(
				(completion) => ({
					...completion,
				}),
			),
		},
	};
}

function sidecarIdForPath(path: string): string {
	return `${contentHash(path)}${contentHash([...path].reverse().join(""))}`;
}

function cloneData(data: DaymarkData): DaymarkData {
	const notes: Record<string, CachedNoteHistory> = {};
	for (const [path, history] of Object.entries(data.notes)) {
		notes[path] = {
			...history,
			dayOrder: [...history.dayOrder],
			spans: history.spans.map((span) => ({
				...span,
				anchor: span.anchor ? { ...span.anchor } : undefined,
			})),
			taskCompletions: history.taskCompletions.map((completion) => ({
				...completion,
			})),
		};
	}
	return {
		schemaVersion: 7,
		settings: {
			...data.settings,
			lightPalette: [...data.settings.lightPalette],
			darkPalette: [...data.settings.darkPalette],
		},
		notes,
	};
}

export class DaymarkStore {
	private data: DaymarkData = {
		...EMPTY_DAYMARK_DATA,
		settings: {
			...EMPTY_DAYMARK_DATA.settings,
			lightPalette: [...EMPTY_DAYMARK_DATA.settings.lightPalette],
			darkPalette: [...EMPTY_DAYMARK_DATA.settings.darkPalette],
		},
		notes: {},
	};
	private legacyData: LegacyData | null = null;
	private readonly records = new Map<string, NoteHistory>();
	private readonly loadedSnapshots = new Set<string>();
	private readonly pendingExternalPaths = new Set<string>();
	private readonly preparePromises = new Map<string, Promise<NoteHistory>>();
	private readonly pausedPaths = new Set<string>();
	private readonly dirtyHistoryPaths = new Set<string>();
	private readonly newSidecarPaths = new Set<string>();
	private sidecarSaveTimer: number | null = null;
	private indexSaveTimer: number | null = null;
	private indexDirty = false;
	private readonly timerWindow: Window;

	constructor(
		private readonly plugin: Plugin,
		private readonly onReconciliationFailure: ReconciliationFailureHandler,
	) {
		this.timerWindow =
			plugin.app.workspace.containerEl.ownerDocument.defaultView ?? activeWindow;
	}

	async load(): Promise<void> {
		const loaded: unknown = await this.plugin.loadData();
		const current = parseCurrentData(loaded);
		if (current) {
			this.data = current;
			return;
		}
		const legacy = parseLegacyData(loaded);
		if (legacy) {
			this.legacyData = legacy;
			this.data = {
				schemaVersion: 7,
				settings: legacy.settings,
				notes: {},
			};
			return;
		}
		this.scheduleIndexSave(SETTINGS_SAVE_DELAY);
	}

	async finishLegacyMigration(): Promise<void> {
		const legacy = this.legacyData;
		if (!legacy) {
			return;
		}
		await this.ensureSidecarDirectory();
		const migratedNotes: Record<string, CachedNoteHistory> = {};
		for (const history of Object.values(legacy.notes)) {
			const file = this.plugin.app.vault.getAbstractFileByPath(history.path);
			const fileCreatedDay =
				file instanceof TFile ? localDay(file.stat.ctime) : null;
			history.explicitBaseline =
				legacy.schemaVersion === 5
					? history.explicitBaseline
					: inferLegacyExplicitBaseline(history, fileCreatedDay);
			if (!shouldPersistHistory(history)) {
				continue;
			}
			const sidecarId = sidecarIdForPath(history.path);
			const anchoredHistory = this.anchoredHistory(history);
			await this.writeSidecar(sidecarId, anchoredHistory);
			migratedNotes[history.path] = this.cacheFromHistory(
				anchoredHistory,
				sidecarId,
			);
			this.records.set(history.path, history);
			this.loadedSnapshots.add(history.path);
		}
		const migratedData: DaymarkData = {
			schemaVersion: 7,
			settings: legacy.settings,
			notes: migratedNotes,
		};
		await this.plugin.saveData(cloneData(migratedData));
		this.data = migratedData;
		this.legacyData = null;
	}

	getRecord(path: string): NoteHistory | null {
		const existing = this.records.get(path);
		if (existing) {
			return existing;
		}
		const cached = this.data.notes[path];
		if (!cached) {
			return null;
		}
		const record = this.historyFromCache(cached);
		this.records.set(path, record);
		return record;
	}

	isPaused(path: string): boolean {
		return (
			this.pausedPaths.has(path) || this.pendingExternalPaths.has(path)
		);
	}

	async prepare(file: TFile, content: string): Promise<NoteHistory> {
		const existingPromise = this.preparePromises.get(file.path);
		if (existingPromise) {
			return existingPromise;
		}
		const promise = this.prepareInternal(file, content).finally(() => {
			this.preparePromises.delete(file.path);
		});
		this.preparePromises.set(file.path, promise);
		return promise;
	}

	getPalettes(): PalettePair {
		return {
			light: [...this.data.settings.lightPalette],
			dark: [...this.data.settings.darkPalette],
		};
	}

	setPalettes(light: readonly string[], dark: readonly string[]): void {
		const palettes = normalizePalettePair(light, dark);
		this.data.settings.lightPalette = palettes.light;
		this.data.settings.darkPalette = palettes.dark;
		this.scheduleIndexSave(SETTINGS_SAVE_DELAY);
	}

	colorCycleLoops(): boolean {
		return this.data.settings.colorCycleLoops;
	}

	setColorCycleLoops(value: boolean): void {
		this.data.settings.colorCycleLoops = value;
		this.scheduleIndexSave(SETTINGS_SAVE_DELAY);
	}

	paletteMode(): PaletteMode {
		return this.data.settings.paletteMode;
	}

	setPaletteMode(value: PaletteMode): void {
		this.data.settings.paletteMode = value;
		this.scheduleIndexSave(SETTINGS_SAVE_DELAY);
	}

	showAnnotationTooltips(): boolean {
		return this.data.settings.showAnnotationTooltips;
	}

	setShowAnnotationTooltips(value: boolean): void {
		this.data.settings.showAnnotationTooltips = value;
		this.scheduleIndexSave(SETTINGS_SAVE_DELAY);
	}

	showCurrentDayTooltips(): boolean {
		return this.data.settings.showCurrentDayTooltips;
	}

	setShowCurrentDayTooltips(value: boolean): void {
		this.data.settings.showCurrentDayTooltips = value;
		this.scheduleIndexSave(SETTINGS_SAVE_DELAY);
	}

	colorCheckedTasks(): boolean {
		return this.data.settings.colorCheckedTasks;
	}

	setColorCheckedTasks(value: boolean): void {
		this.data.settings.colorCheckedTasks = value;
		this.scheduleIndexSave(SETTINGS_SAVE_DELAY);
	}

	useNativeInternalLinks(): boolean {
		return this.data.settings.useNativeInternalLinks;
	}

	setUseNativeInternalLinks(value: boolean): void {
		this.data.settings.useNativeInternalLinks = value;
		this.scheduleIndexSave(SETTINGS_SAVE_DELAY);
	}

	useNativeExternalLinks(): boolean {
		return this.data.settings.useNativeExternalLinks;
	}

	setUseNativeExternalLinks(value: boolean): void {
		this.data.settings.useNativeExternalLinks = value;
		this.scheduleIndexSave(SETTINGS_SAVE_DELAY);
	}

	paletteColorsAt(index: number): { light: string; dark: string } {
		const light = this.data.settings.lightPalette;
		const dark = this.data.settings.darkPalette;
		return {
			light: light[index % light.length] ?? light[0] ?? "#af3029",
			dark: dark[index % dark.length] ?? dark[0] ?? "#d14d41",
		};
	}

	ensure(file: TFile, content: string): NoteHistory {
		const contentDigest = contentHash(content);
		const existing = this.getRecord(file.path);
		if (!existing) {
			const history: NoteHistory = {
				path: file.path,
				createdDay: localDay(file.stat.ctime),
				explicitBaseline: false,
				lastContent: content,
				contentHash: contentDigest,
				dayOrder: [],
				spans: [],
				taskCompletions: [],
			};
			this.records.set(file.path, history);
			this.loadedSnapshots.add(file.path);
			return history;
		}

		if (!this.loadedSnapshots.has(file.path)) {
			existing.lastContent = content;
			if (existing.contentHash === contentDigest) {
				this.loadedSnapshots.add(file.path);
			} else {
				this.pendingExternalPaths.add(file.path);
			}
			return existing;
		}

		if (
			existing.contentHash !== contentDigest ||
			existing.lastContent !== content
		) {
			this.reconcile(existing, content);
		}
		return existing;
	}

	ensureBaseline(file: TFile, content: string): NoteHistory {
		const existing = this.getRecord(file.path);
		if (existing) {
			return existing;
		}
		const history: NoteHistory = {
			path: file.path,
			createdDay: localDay(file.stat.ctime),
			explicitBaseline: false,
			lastContent: content,
			contentHash: contentHash(content),
			dayOrder: [],
			spans: [],
			taskCompletions: [],
		};
		this.records.set(file.path, history);
		this.loadedSnapshots.add(file.path);
		return history;
	}

	commit(
		path: string,
		content: string,
		spans: readonly AnnotationSpan[],
		taskCompletions: readonly TaskCompletion[],
	): void {
		const history = this.records.get(path);
		if (!history || this.isPaused(path)) {
			return;
		}
		history.spans = visibleAnnotationSpans(spans, content);
		history.taskCompletions = normalizeTaskCompletions(
			taskCompletions,
			content,
		);
		for (const record of [...history.spans, ...history.taskCompletions]) {
			if (!history.dayOrder.includes(record.day)) {
				history.dayOrder.push(record.day);
			}
		}
		history.lastContent = content;
		history.contentHash = contentHash(content);
		this.loadedSnapshots.add(path);
		this.markHistoryDirty(history);
	}

	paletteIndex(path: string, day: string): number {
		const history = this.getRecord(path);
		if (!history) {
			return 0;
		}
		let index = history.dayOrder.indexOf(day);
		if (index < 0) {
			history.dayOrder.push(day);
			index = history.dayOrder.length - 1;
			this.markHistoryDirty(history);
		}
		if (this.data.settings.paletteMode === "random") {
			const stableNoteId = this.data.notes[path]?.sidecarId ?? path;
			return resolveRandomPaletteIndex(
				`${stableNoteId}\u0000${day}`,
				this.data.settings.lightPalette.length,
			);
		}
		return resolvePaletteIndex(
			index,
			this.data.settings.lightPalette.length,
			this.data.settings.colorCycleLoops,
		);
	}

	paletteColors(path: string, day: string): { light: string; dark: string } {
		return this.paletteColorsAt(this.paletteIndex(path, day));
	}

	shouldShowAnnotationTooltip(day: string): boolean {
		return (
			this.data.settings.showAnnotationTooltips &&
			(this.data.settings.showCurrentDayTooltips || day !== localDay())
		);
	}

	reset(file: TFile, content: string): NoteHistory {
		const history: NoteHistory = {
			path: file.path,
			createdDay: localDay(),
			explicitBaseline: true,
			lastContent: content,
			contentHash: contentHash(content),
			dayOrder: [],
			spans: [],
			taskCompletions: [],
		};
		this.records.set(file.path, history);
		this.loadedSnapshots.add(file.path);
		this.pendingExternalPaths.delete(file.path);
		this.pausedPaths.delete(file.path);
		this.markHistoryDirty(history);
		return history;
	}

	retry(file: TFile, content: string): boolean {
		const history = this.getRecord(file.path);
		if (!history) {
			this.ensure(file, content);
			return true;
		}
		this.pendingExternalPaths.delete(file.path);
		this.pausedPaths.delete(file.path);
		return this.reconcile(history, content);
	}

	rename(file: TFile, oldPath: string): void {
		const history = this.getRecord(oldPath);
		const cached = this.data.notes[oldPath];
		if (!history && !cached) {
			return;
		}
		delete this.data.notes[oldPath];
		this.records.delete(oldPath);
		if (history) {
			history.path = file.path;
			this.records.set(file.path, history);
			if (shouldPersistHistory(history)) {
				const sidecarId =
					cached?.sidecarId ?? sidecarIdForPath(oldPath);
				this.data.notes[file.path] = this.cacheFromHistory(
					this.anchoredHistory(history),
					sidecarId,
				);
				this.dirtyHistoryPaths.add(file.path);
				this.scheduleSidecarSave();
			}
		} else if (cached) {
			this.data.notes[file.path] = { ...cached, path: file.path };
		}
		this.movePathState(oldPath, file.path);
		this.scheduleIndexSave(SETTINGS_SAVE_DELAY);
	}

	delete(path: string): void {
		const cached = this.data.notes[path];
		delete this.data.notes[path];
		this.records.delete(path);
		this.loadedSnapshots.delete(path);
		this.pendingExternalPaths.delete(path);
		this.pausedPaths.delete(path);
		this.dirtyHistoryPaths.delete(path);
		this.newSidecarPaths.delete(path);
		if (cached) {
			void this.removeSidecar(cached.sidecarId);
			this.scheduleIndexSave(SETTINGS_SAVE_DELAY);
		}
	}

	async flush(): Promise<void> {
		if (this.sidecarSaveTimer !== null) {
			this.timerWindow.clearTimeout(this.sidecarSaveTimer);
			this.sidecarSaveTimer = null;
		}
		if (this.indexSaveTimer !== null) {
			this.timerWindow.clearTimeout(this.indexSaveTimer);
			this.indexSaveTimer = null;
		}
		await this.flushSidecars();
		await this.flushIndex();
	}

	private async prepareInternal(
		file: TFile,
		content: string,
	): Promise<NoteHistory> {
		const cached = this.data.notes[file.path];
		if (!cached) {
			return this.ensure(file, content);
		}
		const contentDigest = contentHash(content);
		if (
			this.loadedSnapshots.has(file.path) &&
			!this.pendingExternalPaths.has(file.path)
		) {
			return this.ensure(file, content);
		}
		if (cached.contentHash === contentDigest) {
			const history = this.getRecord(file.path) ?? this.historyFromCache(cached);
			history.lastContent = content;
			this.records.set(file.path, history);
			this.loadedSnapshots.add(file.path);
			this.pendingExternalPaths.delete(file.path);
			return history;
		}

		const sidecar = await this.readSidecar(cached.sidecarId);
		if (!sidecar) {
			const history = this.getRecord(file.path) ?? this.historyFromCache(cached);
			history.lastContent = content;
			this.records.set(file.path, history);
			this.loadedSnapshots.add(file.path);
			this.pendingExternalPaths.delete(file.path);
			this.pausedPaths.add(file.path);
			this.onReconciliationFailure(file.path);
			return history;
		}
		const history = sidecar.history;
		history.path = file.path;
		this.records.set(file.path, history);
		this.loadedSnapshots.add(file.path);
		this.pendingExternalPaths.delete(file.path);
		if (
			history.contentHash !== contentDigest ||
			history.lastContent !== content
		) {
			this.reconcile(history, content);
		}
		return history;
	}

	private markHistoryDirty(history: NoteHistory): void {
		if (!shouldPersistHistory(history) || history.lastContent.length === 0) {
			return;
		}
		const wasIndexed = this.data.notes[history.path] !== undefined;
		const sidecarId =
			this.data.notes[history.path]?.sidecarId ??
			sidecarIdForPath(history.path);
		const anchored = this.anchoredHistory(history);
		this.data.notes[history.path] = this.cacheFromHistory(
			anchored,
			sidecarId,
		);
		this.dirtyHistoryPaths.add(history.path);
		this.indexDirty = true;
		if (!wasIndexed) {
			this.newSidecarPaths.add(history.path);
		}
		this.scheduleSidecarSave();
		this.scheduleIndexSave(INDEX_CACHE_SAVE_DELAY);
	}

	private anchoredHistory(history: NoteHistory): NoteHistory {
		return {
			...history,
			dayOrder: [...history.dayOrder],
			spans: addTextAnchors(
				visibleAnnotationSpans(history.spans, history.lastContent),
				history.lastContent,
			),
			taskCompletions: history.taskCompletions.map((completion) => ({
				...completion,
			})),
		};
	}

	private cacheFromHistory(
		history: NoteHistory,
		sidecarId: string,
	): CachedNoteHistory {
		return {
			path: history.path,
			sidecarId,
			createdDay: history.createdDay,
			explicitBaseline: history.explicitBaseline,
			contentHash: history.contentHash,
			dayOrder: [...history.dayOrder],
			spans: history.spans.map((span) => ({
				...span,
				anchor: span.anchor ? { ...span.anchor } : undefined,
			})),
			taskCompletions: history.taskCompletions.map((completion) => ({
				...completion,
			})),
		};
	}

	private historyFromCache(history: CachedNoteHistory): NoteHistory {
		return {
			path: history.path,
			createdDay: history.createdDay,
			explicitBaseline: history.explicitBaseline,
			lastContent: "",
			contentHash: history.contentHash,
			dayOrder: [...history.dayOrder],
			spans: history.spans.map((span) => ({
				...span,
				anchor: span.anchor ? { ...span.anchor } : undefined,
			})),
			taskCompletions: history.taskCompletions.map((completion) => ({
				...completion,
			})),
		};
	}

	private reconcile(history: NoteHistory, content: string): boolean {
		if (this.pausedPaths.has(history.path)) {
			return false;
		}
		try {
			history.spans = visibleAnnotationSpans(
				reconcileContent({
					oldContent: history.lastContent,
					newContent: content,
					spans: history.spans,
					today: localDay(),
					createdDay: history.createdDay,
				}),
				content,
			);
			history.taskCompletions = reconcileTaskCompletions({
				oldContent: history.lastContent,
				newContent: content,
				completions: history.taskCompletions,
			});
			for (const record of [...history.spans, ...history.taskCompletions]) {
				if (!history.dayOrder.includes(record.day)) {
					history.dayOrder.push(record.day);
				}
			}
			history.lastContent = content;
			history.contentHash = contentHash(content);
			this.markHistoryDirty(history);
			return true;
		} catch {
			this.pausedPaths.add(history.path);
			this.onReconciliationFailure(history.path);
			return false;
		}
	}

	private scheduleSidecarSave(): void {
		if (this.sidecarSaveTimer !== null) {
			this.timerWindow.clearTimeout(this.sidecarSaveTimer);
		}
		this.sidecarSaveTimer = this.timerWindow.setTimeout(() => {
			this.sidecarSaveTimer = null;
			void this.flushSidecars();
		}, SIDECAR_SAVE_DELAY);
	}

	private scheduleIndexSave(delay: number): void {
		this.indexDirty = true;
		if (this.indexSaveTimer !== null) {
			this.timerWindow.clearTimeout(this.indexSaveTimer);
		}
		this.indexSaveTimer = this.timerWindow.setTimeout(() => {
			this.indexSaveTimer = null;
			void this.flushIndex();
		}, delay);
	}

	private async flushSidecars(): Promise<void> {
		if (this.dirtyHistoryPaths.size === 0) {
			return;
		}
		await this.ensureSidecarDirectory();
		const paths = [...this.dirtyHistoryPaths];
		paths.forEach((path) => this.dirtyHistoryPaths.delete(path));
		let requiresIndexSave = false;
		try {
			for (const path of paths) {
				const history = this.records.get(path);
				const cached = this.data.notes[path];
				if (!history || !cached || !shouldPersistHistory(history)) {
					continue;
				}
				await this.writeSidecar(
					cached.sidecarId,
					this.anchoredHistory(history),
				);
				if (this.newSidecarPaths.delete(path)) {
					requiresIndexSave = true;
				}
			}
		} catch (error) {
			paths.forEach((path) => this.dirtyHistoryPaths.add(path));
			throw error;
		}
		if (requiresIndexSave) {
			await this.flushIndex();
		}
		if (this.dirtyHistoryPaths.size > 0) {
			await this.flushSidecars();
		}
	}

	private async flushIndex(): Promise<void> {
		if (!this.indexDirty) {
			return;
		}
		this.indexDirty = false;
		await this.plugin.saveData(cloneData(this.data));
		if (this.indexDirty) {
			await this.flushIndex();
		}
	}

	private async ensureSidecarDirectory(): Promise<void> {
		const adapter = this.plugin.app.vault.adapter;
		if (!(await adapter.exists(SIDECAR_ROOT))) {
			await adapter.mkdir(SIDECAR_ROOT);
		}
		if (!(await adapter.exists(SIDECAR_NOTES))) {
			await adapter.mkdir(SIDECAR_NOTES);
		}
	}

	private sidecarPath(sidecarId: string): string {
		return normalizePath(`${SIDECAR_NOTES}/${sidecarId}.json`);
	}

	private async writeSidecar(
		sidecarId: string,
		history: NoteHistory,
	): Promise<void> {
		const sidecar: DaymarkSidecar = {
			schemaVersion: 1,
			history,
		};
		await this.plugin.app.vault.adapter.write(
			this.sidecarPath(sidecarId),
			JSON.stringify(sidecar, null, 2),
		);
	}

	private async readSidecar(
		sidecarId: string,
	): Promise<DaymarkSidecar | null> {
		const path = this.sidecarPath(sidecarId);
		const adapter = this.plugin.app.vault.adapter;
		if (!(await adapter.exists(path))) {
			return null;
		}
		try {
			return parseSidecar(JSON.parse(await adapter.read(path)) as unknown);
		} catch {
			return null;
		}
	}

	private async removeSidecar(sidecarId: string): Promise<void> {
		const path = this.sidecarPath(sidecarId);
		const adapter = this.plugin.app.vault.adapter;
		if (await adapter.exists(path)) {
			await adapter.remove(path);
		}
	}

	private movePathState(oldPath: string, newPath: string): void {
		for (const paths of [
			this.loadedSnapshots,
			this.pendingExternalPaths,
			this.pausedPaths,
			this.dirtyHistoryPaths,
			this.newSidecarPaths,
		]) {
			if (paths.delete(oldPath)) {
				paths.add(newPath);
			}
		}
	}
}
