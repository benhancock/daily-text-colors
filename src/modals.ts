import { App, Modal, Setting } from "obsidian";
import { countCharactersByDay } from "./core/ranges";
import { countTaskCompletionsByDay } from "./core/tasks";
import type { NoteHistory } from "./types";

export class DayLegendModal extends Modal {
	constructor(
		app: App,
		private readonly history: NoteHistory,
		private readonly paletteColors: (day: string) => { light: string; dark: string },
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("daily-text-colors-modal");
		this.setTitle("Day legend");
		const counts = countCharactersByDay(this.history.spans);
		const taskCounts = countTaskCompletionsByDay(this.history.taskCompletions);
		const annotatedDays = this.history.dayOrder.filter(
			(day) => (counts.get(day) ?? 0) > 0 || (taskCounts.get(day) ?? 0) > 0,
		);
		if (annotatedDays.length === 0) {
			this.contentEl.createEl("p", {
				text: "No later additions have been recorded for this note.",
			});
		} else {
			const list = this.contentEl.createEl("ul", {
				cls: "daily-text-colors-legend",
				attr: { "aria-label": "Annotation dates" },
			});
			for (const day of annotatedDays) {
				const item = list.createEl("li", { cls: "daily-text-colors-legend-item" });
				const swatch = item.createSpan({
					cls: "daily-text-colors-swatch",
					attr: {
						"role": "img",
						"aria-label": `Color for ${day}`,
					},
				});
				const colors = this.paletteColors(day);
				swatch.setCssProps({
					"--daily-text-colors-light-color": colors.light,
					"--daily-text-colors-dark-color": colors.dark,
				});
				const characters = counts.get(day) ?? 0;
				const tasks = taskCounts.get(day) ?? 0;
				const parts = [
					`${characters} ${characters === 1 ? "character" : "characters"}`,
				];
				if (tasks > 0) {
					parts.push(`${tasks} completed ${tasks === 1 ? "task" : "tasks"}`);
				}
				item.createSpan({
					text: `${day} — ${parts.join(", ")}`,
				});
			}
		}

		new Setting(this.contentEl).addButton((button) => {
			button.setButtonText("Close").onClick(() => this.close());
			button.buttonEl.focus();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class ResetBaselineModal extends Modal {
	constructor(
		app: App,
		private readonly onConfirm: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("daily-text-colors-modal");
		this.setTitle("Reset annotation baseline");
		this.contentEl.createEl("p", {
			text: "Clear this note’s annotation history and treat its current text as the new original baseline?",
		});

		new Setting(this.contentEl)
			.addButton((button) => {
				button.setButtonText("Cancel").onClick(() => this.close());
				button.buttonEl.focus();
			})
			.addButton((button) => {
				button
					.setButtonText("Reset baseline")
					.setWarning()
					.onClick(() => {
						this.onConfirm();
						this.close();
					});
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class ReconciliationModal extends Modal {
	constructor(
		app: App,
		private readonly onRetry: () => void,
		private readonly onReset: () => void,
		private readonly onDismiss: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("daily-text-colors-modal");
		this.setTitle("Annotation history needs attention");
		this.contentEl.createEl("p", {
			text: "This note changed outside the observed editor and its annotation ranges could not be mapped safely.",
		});

		new Setting(this.contentEl)
			.addButton((button) => {
				button
					.setButtonText("Retry")
					.onClick(() => {
						this.onRetry();
						this.close();
					});
				button.buttonEl.focus();
			})
			.addButton((button) => {
				button
					.setButtonText("Reset baseline")
					.setWarning()
					.onClick(() => {
						this.onReset();
						this.close();
					});
			});
	}

	onClose(): void {
		this.contentEl.empty();
		this.onDismiss();
	}
}
