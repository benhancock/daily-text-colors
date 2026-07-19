import { MarkdownView, Notice, Plugin, TFile } from "obsidian";
import {
	createDaymarkEditorController,
	type DaymarkEditorController,
} from "./editor-extension";
import {
	DayLegendModal,
	ReconciliationModal,
	ResetBaselineModal,
} from "./modals";
import { renderReadingAnnotations } from "./reading-view";
import { DaymarkSettingTab } from "./settings";
import { DaymarkStore } from "./store";
import type { PaletteMode, PalettePair } from "./core/palette";

export default class Daymark extends Plugin {
	private store!: DaymarkStore;
	private editorController!: DaymarkEditorController;
	private displayEnabled = true;
	private readonly openRecoveryDialogs = new Set<string>();

	async onload(): Promise<void> {
		this.store = new DaymarkStore(this, (path) => this.showReconciliationFailure(path));
		await this.store.load();

		this.editorController = createDaymarkEditorController(
			this.store,
			() => this.displayEnabled,
		);
		this.registerEditorExtension(this.editorController.extension);
		this.addSettingTab(new DaymarkSettingTab(this.app, this));
		this.registerMarkdownPostProcessor(async (element, context) => {
			if (!this.displayEnabled) {
				return;
			}
			const file = this.app.vault.getAbstractFileByPath(context.sourcePath);
			if (!(file instanceof TFile)) {
				return;
			}
			const content = await this.app.vault.cachedRead(file);
			renderReadingAnnotations(
				element,
				context,
				this.store,
				this.displayEnabled,
				content,
			);
		});

		this.registerCommands();
		this.applyDisplayState();
		this.applyLinkStyleState();
		this.app.workspace.onLayoutReady(() => {
			void this.finishStartup();
		});
	}

	onunload(): void {
		this.app.workspace.containerEl.removeClasses([
			"daymark-display-off",
			"daymark-native-internal-links",
			"daymark-native-external-links",
		]);
		void this.store.flush();
	}

	getPalettes(): PalettePair {
		return this.store.getPalettes();
	}

	setPalettes(light: readonly string[], dark: readonly string[]): void {
		this.store.setPalettes(light, dark);
		this.editorController.refresh();
		this.refreshRenderedColors();
	}

	colorCycleLoops(): boolean {
		return this.store.colorCycleLoops();
	}

	setColorCycleLoops(value: boolean): void {
		this.store.setColorCycleLoops(value);
		this.editorController.refresh();
		this.refreshRenderedColors();
	}

	paletteMode(): PaletteMode {
		return this.store.paletteMode();
	}

	setPaletteMode(value: PaletteMode): void {
		this.store.setPaletteMode(value);
		this.editorController.refresh();
		this.refreshRenderedColors();
	}

	showAnnotationTooltips(): boolean {
		return this.store.showAnnotationTooltips();
	}

	setShowAnnotationTooltips(value: boolean): void {
		this.store.setShowAnnotationTooltips(value);
		this.editorController.refresh();
	}

	showCurrentDayTooltips(): boolean {
		return this.store.showCurrentDayTooltips();
	}

	setShowCurrentDayTooltips(value: boolean): void {
		this.store.setShowCurrentDayTooltips(value);
		this.editorController.refresh();
	}

	colorCheckedTasks(): boolean {
		return this.store.colorCheckedTasks();
	}

	setColorCheckedTasks(value: boolean): void {
		this.store.setColorCheckedTasks(value);
		this.editorController.refresh();
	}

	useNativeInternalLinks(): boolean {
		return this.store.useNativeInternalLinks();
	}

	setUseNativeInternalLinks(value: boolean): void {
		this.store.setUseNativeInternalLinks(value);
		this.applyLinkStyleState();
	}

	useNativeExternalLinks(): boolean {
		return this.store.useNativeExternalLinks();
	}

	setUseNativeExternalLinks(value: boolean): void {
		this.store.setUseNativeExternalLinks(value);
		this.applyLinkStyleState();
	}

	private registerCommands(): void {
		this.addCommand({
			id: "show-day-legend",
			name: "Show day legend",
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view?.file) {
					return false;
				}
				if (!checking) {
					const history = this.store.ensure(view.file, view.editor.getValue());
					new DayLegendModal(
						this.app,
						history,
						(day) => this.store.paletteColors(view.file?.path ?? "", day),
					).open();
				}
				return true;
			},
		});

		this.addCommand({
			id: "toggle-annotations",
			name: "Toggle annotations",
			callback: () => {
				this.displayEnabled = !this.displayEnabled;
				this.applyDisplayState();
				this.editorController.refresh();
				new Notice(
					this.displayEnabled
						? "Annotation colors shown"
						: "Annotation colors hidden",
				);
			},
		});

		this.addCommand({
			id: "reset-annotation-baseline",
			name: "Reset annotation baseline",
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view?.file) {
					return false;
				}
				if (!checking) {
					const file = view.file;
					new ResetBaselineModal(this.app, () => {
						this.store.reset(file, view.editor.getValue());
						this.editorController.refresh(file.path);
						new Notice("Annotation baseline reset");
					}).open();
				}
				return true;
			},
		});
	}

	private registerVaultEvents(): void {
		this.registerEvent(
			this.app.vault.on("create", (abstractFile) => {
				if (abstractFile instanceof TFile && abstractFile.extension === "md") {
					void this.ensureFile(abstractFile);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on("modify", (abstractFile) => {
				if (abstractFile instanceof TFile && abstractFile.extension === "md") {
					void this.ensureFile(abstractFile);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (abstractFile, oldPath) => {
				if (abstractFile instanceof TFile && abstractFile.extension === "md") {
					this.store.rename(abstractFile, oldPath);
					this.editorController.refresh(abstractFile.path);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (abstractFile) => {
				if (abstractFile instanceof TFile && abstractFile.extension === "md") {
					this.store.delete(abstractFile.path);
				}
			}),
		);
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				void this.handleFileOpen(file);
			}),
		);
	}

	private async ensureFile(file: TFile): Promise<void> {
		const tracked = this.store.getRecord(file.path);
		if (!tracked) {
			return;
		}
		const content = await this.app.vault.cachedRead(file);
		const previousHash = tracked.contentHash;
		const history = await this.store.prepare(file, content);
		if (history.contentHash !== previousHash) {
			this.editorController.refresh(file.path);
		}
	}

	private async finishStartup(): Promise<void> {
		try {
			await this.store.finishLegacyMigration();
		} catch {
			new Notice("Daymark could not migrate its annotation storage");
		}
		this.registerVaultEvents();
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile instanceof TFile && activeFile.extension === "md") {
			await this.ensureFile(activeFile);
			this.editorController.refresh(activeFile.path);
		}
	}

	private async handleFileOpen(file: TFile | null): Promise<void> {
		await this.store.flush();
		if (file instanceof TFile && file.extension === "md") {
			await this.ensureFile(file);
			this.editorController.refresh(file.path);
		}
	}

	private applyDisplayState(): void {
		this.app.workspace.containerEl.toggleClass(
			"daymark-display-off",
			!this.displayEnabled,
		);
	}

	private applyLinkStyleState(): void {
		const workspace = this.app.workspace.containerEl;
		workspace.toggleClass(
			"daymark-native-internal-links",
			this.store.useNativeInternalLinks(),
		);
		workspace.toggleClass(
			"daymark-native-external-links",
			this.store.useNativeExternalLinks(),
		);
	}

	private refreshRenderedColors(): void {
		const ownerDocument = this.app.workspace.containerEl.ownerDocument;
		const annotations = ownerDocument.querySelectorAll<HTMLElement>(
			".daymark-annotation[data-daymark-color-index], .daymark-task-completion[data-daymark-color-index], .daymark-task-completion-line[data-daymark-color-index]",
		);
		annotations.forEach((annotation) => {
			const path = annotation.dataset.daymarkPath;
			const day = annotation.dataset.daymarkDate;
			const index =
				path && day
					? this.store.paletteIndex(path, day)
					: Number(annotation.dataset.daymarkColorIndex);
			if (Number.isInteger(index)) {
				annotation.dataset.daymarkColorIndex = String(index);
				const colors = this.store.paletteColorsAt(index);
				annotation.setCssProps({
					"--daymark-light-color": colors.light,
					"--daymark-dark-color": colors.dark,
				});
			}
		});
	}

	private showReconciliationFailure(path: string): void {
		new Notice("Daymark paused for a note whose edits could not be reconciled");
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile?.path !== path || this.openRecoveryDialogs.has(path)) {
			return;
		}
		this.openRecoveryDialogs.add(path);
		const closeDialog = (): void => {
			this.openRecoveryDialogs.delete(path);
		};
		const modal = new ReconciliationModal(
			this.app,
			() => {
				void this.retryReconciliation(activeFile);
				closeDialog();
			},
			() => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				const content =
					view?.file?.path === activeFile.path
						? view.editor.getValue()
						: this.store.getRecord(activeFile.path)?.lastContent ?? "";
				this.store.reset(activeFile, content);
				this.editorController.refresh(activeFile.path);
				closeDialog();
				new Notice("Annotation baseline reset");
			},
			closeDialog,
		);
		modal.open();
	}

	private async retryReconciliation(file: TFile): Promise<void> {
		const content = await this.app.vault.cachedRead(file);
		await this.store.prepare(file, content);
		if (this.store.retry(file, content)) {
			this.editorController.refresh(file.path);
			new Notice("Annotation history reconciled");
		} else {
			new Notice("Annotation history still could not be reconciled");
		}
	}
}
