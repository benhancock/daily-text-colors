import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import {
	DEFAULT_DARK_PALETTE,
	DEFAULT_LIGHT_PALETTE,
	PALETTE_PRESETS,
	matchingPalettePreset,
	nextDefaultColors,
	palettePresetById,
} from "./core/palette";
import type Daymark from "./main";

export class DaymarkSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: Daymark) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("daymark-settings");

		new Setting(containerEl).setName("Color cycle").setHeading();
		containerEl.createEl("p", {
			cls: "daymark-cycle-description",
			text: "Ordered mode gives each unique annotation date the next color below. Random mode picks a stable random color from the same list for each annotation date.",
		});

		const palettes = this.plugin.getPalettes();
		const paletteOptionsGroup = containerEl.createDiv({
			cls: "setting-group daymark-palette-options-group",
		});
		const paletteOptionsItems = paletteOptionsGroup.createDiv({
			cls: "setting-items daymark-palette-options",
		});
		new Setting(paletteOptionsItems)
			.setName("Palette preset")
			.setDesc("Replace the editable color list below with a preset.")
			.addDropdown((dropdown) => {
				dropdown.addOption("custom", "Custom");
				for (const preset of PALETTE_PRESETS) {
					dropdown.addOption(preset.id, preset.name);
				}
				dropdown
					.setValue(matchingPalettePreset(palettes)?.id ?? "custom")
					.onChange((value) => {
						if (value === "custom") {
							return;
						}
						const preset = palettePresetById(value);
						if (!preset) {
							return;
						}
						this.plugin.setPalettes([...preset.light], [...preset.dark]);
						this.display();
						new Notice(`${preset.name} palette applied`);
					});
			});
		new Setting(paletteOptionsItems)
			.setName("Color selection")
			.setDesc(
				"Choose whether annotation dates follow the list order or pick from it at random.",
			)
			.addDropdown((dropdown) => {
				dropdown
					.addOption("ordered", "Ordered list")
					.addOption("random", "Random from list")
					.setValue(this.plugin.paletteMode())
					.onChange((value) => {
						if (value !== "ordered" && value !== "random") {
							return;
						}
						this.plugin.setPaletteMode(value);
						this.display();
					});
			});

		const paletteGroup = containerEl.createDiv({
			cls: "setting-group daymark-palette-group",
		});
		const paletteTable = paletteGroup.createDiv({
			cls: "setting-items daymark-palette-table",
			attr: {
				"role": "table",
				"aria-label": "Annotation color cycle",
			},
		});

		palettes.light.forEach((lightColor, index) => {
			const darkColor = palettes.dark[index] ?? lightColor;
			let lightSwatch: HTMLElement | null = null;
			let darkSwatch: HTMLElement | null = null;
			const setting = new Setting(paletteTable)
				.setName(`Color ${index + 1}`)
				.addColorPicker((picker) => {
					picker.setValue(lightColor).onChange((value) => {
						lightSwatch?.setCssProps({
							"--daymark-picker-color": value,
						});
						const updated = this.plugin.getPalettes();
						updated.light[index] = value;
						this.plugin.setPalettes(updated.light, updated.dark);
					});
				})
				.addColorPicker((picker) => {
					picker.setValue(darkColor).onChange((value) => {
						darkSwatch?.setCssProps({
							"--daymark-picker-color": value,
						});
						const updated = this.plugin.getPalettes();
						updated.dark[index] = value;
						this.plugin.setPalettes(updated.light, updated.dark);
					});
				})
				.addExtraButton((button) => {
					button
						.setIcon("arrow-up")
						.setTooltip("Move color earlier")
						.setDisabled(index === 0)
						.onClick(() => {
							this.moveColor(index, -1);
						});
				})
				.addExtraButton((button) => {
					button
						.setIcon("arrow-down")
						.setTooltip("Move color later")
						.setDisabled(index === palettes.light.length - 1)
						.onClick(() => {
							this.moveColor(index, 1);
						});
				})
				.addExtraButton((button) => {
					button
						.setIcon("trash-2")
						.setTooltip("Remove color")
						.setDisabled(palettes.light.length === 1)
						.onClick(() => {
							const updated = this.plugin.getPalettes();
							updated.light.splice(index, 1);
							updated.dark.splice(index, 1);
							this.plugin.setPalettes(updated.light, updated.dark);
							this.display();
						});
				});
			setting.settingEl.addClass("daymark-palette-setting");
			setting.settingEl.setAttr("role", "row");
			setting.nameEl.setAttr("role", "rowheader");
			const colorInputs =
				setting.controlEl.querySelectorAll<HTMLInputElement>('input[type="color"]');
			colorInputs[0]?.setAttrs({
				"aria-label": `Color ${index + 1} in light mode`,
				"data-tooltip-position": "top",
			});
			colorInputs[1]?.setAttrs({
				"aria-label": `Color ${index + 1} in dark mode`,
				"data-tooltip-position": "top",
			});
			lightSwatch = this.wrapColorInput(
				setting.controlEl,
				colorInputs[0],
				lightColor,
				"Light",
			);
			darkSwatch = this.wrapColorInput(
				setting.controlEl,
				colorInputs[1],
				darkColor,
				"Dark",
			);
		});

		const actions = new Setting(paletteTable);
		actions.settingEl.addClass("daymark-palette-actions");
		actions.settingEl.setAttr("role", "row");
		actions
			.addButton((button) => {
				button
					.setButtonText("Add color")
					.onClick(() => {
						const updated = this.plugin.getPalettes();
						const colors = nextDefaultColors(updated.light.length);
						updated.light.push(colors.light);
						updated.dark.push(colors.dark);
						this.plugin.setPalettes(updated.light, updated.dark);
						this.display();
					});
				button.buttonEl.addClass("daymark-compact-button");
			})
			.addButton((button) => {
				button
					.setButtonText("Restore defaults")
					.onClick(() => {
						this.plugin.setPalettes(
							[...DEFAULT_LIGHT_PALETTE],
							[...DEFAULT_DARK_PALETTE],
						);
						this.display();
						new Notice("Flexoki palettes restored");
					});
				button.buttonEl.addClass("daymark-compact-button");
			});

		const cycleBehaviorGroup = containerEl.createDiv({
			cls: "setting-group daymark-cycle-behavior-group",
		});
		const cycleBehaviorItems = cycleBehaviorGroup.createDiv({
			cls: "setting-items",
		});
		new Setting(cycleBehaviorItems)
			.setName("Stop at final color")
			.setDesc(
				"Only applies to ordered list mode. When enabled, the final color repeats for additional annotation dates. When disabled, the color list repeats from the beginning.",
			)
			.addToggle((toggle) => {
				toggle
					.setValue(!this.plugin.colorCycleLoops())
					.setDisabled(this.plugin.paletteMode() === "random")
					.onChange((value) => {
						this.plugin.setColorCycleLoops(!value);
					});
			});

		new Setting(containerEl).setName("Tooltips").setHeading();
		const tooltipGroup = containerEl.createDiv({
			cls: "setting-group daymark-tooltip-group",
		});
		const tooltipItems = tooltipGroup.createDiv({
			cls: "setting-items daymark-tooltip-items",
		});
		new Setting(tooltipItems)
			.setName("Show timestamp tooltips")
			.setDesc("Show the annotation date when hovering colored text.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.showAnnotationTooltips())
					.onChange((value) => {
						this.plugin.setShowAnnotationTooltips(value);
						this.display();
					});
			});
		new Setting(tooltipItems)
			.setName("Show tooltips for today’s annotations")
			.setDesc(
				"Show timestamp tooltips for text added today as well as older annotation dates.",
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.showCurrentDayTooltips())
					.setDisabled(!this.plugin.showAnnotationTooltips())
					.onChange((value) => {
						this.plugin.setShowCurrentDayTooltips(value);
					});
			});

		new Setting(containerEl).setName("Task checkboxes").setHeading();
		const taskGroup = containerEl.createDiv({
			cls: "setting-group daymark-task-group",
		});
		const taskItems = taskGroup.createDiv({
			cls: "setting-items daymark-task-items",
		});
		new Setting(taskItems)
			.setName("Color completed-task strikethrough")
			.setDesc(
				"When enabled, checking a task keeps the text color unchanged and colors only the completed-task strikethrough.",
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.colorCheckedTasks())
					.onChange((value) => {
						this.plugin.setColorCheckedTasks(value);
					});
			});

		new Setting(containerEl).setName("Link colors").setHeading();
		const linkGroup = containerEl.createDiv({
			cls: "setting-group daymark-link-group",
		});
		const linkItems = linkGroup.createDiv({
			cls: "setting-items daymark-link-items",
		});
		new Setting(linkItems)
			.setName("Apply annotation colors to wiki links")
			.addToggle((toggle) => {
				toggle
					.setValue(!this.plugin.useNativeInternalLinks())
					.onChange((value) => {
						this.plugin.setUseNativeInternalLinks(!value);
					});
			});
		new Setting(linkItems)
			.setName("Apply annotation colors to external links")
			.addToggle((toggle) => {
				toggle
					.setValue(!this.plugin.useNativeExternalLinks())
					.onChange((value) => {
						this.plugin.setUseNativeExternalLinks(!value);
					});
			});
	}

	private wrapColorInput(
		container: HTMLElement,
		input: HTMLInputElement | undefined,
		color: string,
		mode: "Light" | "Dark",
	): HTMLElement | null {
		if (!input) {
			return null;
		}
		const field = container.createDiv({
			cls: "daymark-color-field",
			attr: { "role": "cell" },
		});
		container.insertBefore(field, input);
		field.createSpan({ cls: "daymark-color-mode", text: mode });
		const swatch = field.createDiv({ cls: "daymark-color-swatch" });
		swatch.setCssProps({ "--daymark-picker-color": color });
		swatch.appendChild(input);
		return swatch;
	}

	private moveColor(index: number, offset: -1 | 1): void {
		const updated = this.plugin.getPalettes();
		const target = index + offset;
		const lightColor = updated.light[index];
		const darkColor = updated.dark[index];
		if (
			lightColor === undefined ||
			darkColor === undefined ||
			target < 0 ||
			target >= updated.light.length
		) {
			return;
		}
		updated.light.splice(index, 1);
		updated.dark.splice(index, 1);
		updated.light.splice(target, 0, lightColor);
		updated.dark.splice(target, 0, darkColor);
		this.plugin.setPalettes(updated.light, updated.dark);
		this.display();
	}
}
