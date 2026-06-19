import type { Model } from "@earendil-works/pi-ai";
import { Container, type Focusable, Input, Spacer, Text, type TUI } from "@earendil-works/pi-tui";
import type { ModelRegistry } from "../../../core/model-registry.ts";
import type { SettingsManager } from "../../../core/settings-manager.ts";
import { theme } from "../theme/theme.ts";
import { DynamicBorder } from "./dynamic-border.ts";
import { keyHint } from "./keybinding-hints.ts";
import { dispatchModelSelectorKey } from "./model-selector-input.ts";
import {
	applyModelFilter,
	buildActiveModelList,
	computeModelSelectedIndex,
	emptyModelState,
	refreshScopedModels,
	sortModelsWithCurrentFirst,
	toModelItems,
} from "./model-selector-load.ts";
import {
	renderModelListEmpty,
	renderModelListError,
	renderModelListRows,
	renderModelListScrollIndicator,
	renderModelListSelectedFooter,
} from "./model-selector-render.ts";
import type { ModelItem, ModelScope, ScopedModelItem } from "./model-selector-types.ts";

/**
 * Component that renders a model selector with search
 */
export class ModelSelectorComponent extends Container implements Focusable {
	private searchInput: Input;

	// Focusable implementation - propagate to searchInput for IME cursor positioning
	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}
	private listContainer: Container;
	private allModels: ModelItem[] = [];
	private scopedModelItems: ModelItem[] = [];
	private activeModels: ModelItem[] = [];
	private filteredModels: ModelItem[] = [];
	private selectedIndex: number = 0;
	private currentModel?: Model<any>;
	private settingsManager: SettingsManager;
	private modelRegistry: ModelRegistry;
	private onSelectCallback: (model: Model<any>) => void;
	private onCancelCallback: () => void;
	private errorMessage?: string;
	private tui: TUI;
	private scopedModels: ReadonlyArray<ScopedModelItem>;
	private scope: ModelScope = "all";
	private scopeText?: Text;
	private scopeHintText?: Text;

	constructor(
		tui: TUI,
		currentModel: Model<any> | undefined,
		settingsManager: SettingsManager,
		modelRegistry: ModelRegistry,
		scopedModels: ReadonlyArray<ScopedModelItem>,
		onSelect: (model: Model<any>) => void,
		onCancel: () => void,
		initialSearchInput?: string,
	) {
		super();

		this.tui = tui;
		this.currentModel = currentModel;
		this.settingsManager = settingsManager;
		this.modelRegistry = modelRegistry;
		this.scopedModels = scopedModels;
		this.scope = scopedModels.length > 0 ? "scoped" : "all";
		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;

		// Add top border
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		// Add hint about model filtering
		if (scopedModels.length > 0) {
			this.scopeText = new Text(this.getScopeText(), 0, 0);
			this.addChild(this.scopeText);
			this.scopeHintText = new Text(this.getScopeHintText(), 0, 0);
			this.addChild(this.scopeHintText);
		} else {
			const hintText = "Only showing models from configured providers. Use /login to add providers.";
			this.addChild(new Text(theme.fg("warning", hintText), 0, 0));
		}
		this.addChild(new Spacer(1));

		// Create search input
		this.searchInput = new Input();
		if (initialSearchInput) {
			this.searchInput.setValue(initialSearchInput);
		}
		this.searchInput.onSubmit = () => {
			// Enter on search input selects the first filtered item
			if (this.filteredModels[this.selectedIndex]) {
				this.handleSelect(this.filteredModels[this.selectedIndex].model);
			}
		};
		this.addChild(this.searchInput);

		this.addChild(new Spacer(1));

		// Create list container
		this.listContainer = new Container();
		this.addChild(this.listContainer);

		this.addChild(new Spacer(1));

		// Add bottom border
		this.addChild(new DynamicBorder());

		// Load models and do initial render
		this.loadModels().then(() => {
			if (initialSearchInput) {
				this.filterModels(initialSearchInput);
			} else {
				this.updateList();
			}
			// Request re-render after models are loaded
			this.tui.requestRender();
		});
	}

	private async loadModels(): Promise<void> {
		// Refresh to pick up any changes to models.json
		this.modelRegistry.refresh();

		// Surface any load error to the UI
		const loadError = this.modelRegistry.getError();
		if (loadError) {
			this.errorMessage = loadError;
		}

		let models: ModelItem[];
		try {
			models = toModelItems(await this.modelRegistry.getAvailable());
		} catch (error) {
			Object.assign(this, emptyModelState());
			this.errorMessage = error instanceof Error ? error.message : String(error);
			return;
		}

		this.allModels = sortModelsWithCurrentFirst(models, this.currentModel);
		this.scopedModels = refreshScopedModels(this.modelRegistry, this.scopedModels);
		this.scopedModelItems = toModelItems(this.scopedModels.map((scoped) => scoped.model));
		this.activeModels = buildActiveModelList(this.scope, this.allModels, this.scopedModelItems);
		this.filteredModels = this.activeModels;
		this.selectedIndex = computeModelSelectedIndex(this.filteredModels, this.currentModel, this.selectedIndex);
	}

	private getScopeText(): string {
		const allText = this.scope === "all" ? theme.fg("accent", "all") : theme.fg("muted", "all");
		const scopedText = this.scope === "scoped" ? theme.fg("accent", "scoped") : theme.fg("muted", "scoped");
		return `${theme.fg("muted", "Scope: ")}${allText}${theme.fg("muted", " | ")}${scopedText}`;
	}

	private getScopeHintText(): string {
		return keyHint("tui.input.tab", "scope") + theme.fg("muted", " (all/scoped)");
	}

	private setScope(scope: ModelScope): void {
		if (this.scope === scope) return;
		this.scope = scope;
		this.activeModels = buildActiveModelList(this.scope, this.allModels, this.scopedModelItems);
		this.selectedIndex = computeModelSelectedIndex(this.activeModels, this.currentModel, 0);
		this.filterModels(this.searchInput.getValue());
		if (this.scopeText) {
			this.scopeText.setText(this.getScopeText());
		}
	}

	private filterModels(query: string): void {
		const { filtered, selectedIndex } = applyModelFilter(this.activeModels, query, this.selectedIndex);
		this.filteredModels = filtered;
		this.selectedIndex = selectedIndex;
		this.updateList();
	}

	private updateList(): void {
		this.listContainer.clear();

		const { startIndex, endIndex } = renderModelListRows(
			this.listContainer,
			this.filteredModels,
			this.selectedIndex,
			this.currentModel,
		);

		renderModelListScrollIndicator(
			this.listContainer,
			this.filteredModels.length,
			this.selectedIndex,
			startIndex,
			endIndex,
		);

		this.renderListFooter();
	}

	private renderListFooter(): void {
		if (this.errorMessage) {
			renderModelListError(this.listContainer, this.errorMessage);
			return;
		}
		if (this.filteredModels.length === 0) {
			renderModelListEmpty(this.listContainer);
			return;
		}
		renderModelListSelectedFooter(this.listContainer, this.filteredModels, this.selectedIndex);
	}

	handleInput(keyData: string): void {
		const action = dispatchModelSelectorKey(keyData, {
			selectedIndex: this.selectedIndex,
			filteredCount: this.filteredModels.length,
			scopedCount: this.scopedModelItems.length,
		});

		switch (action.type) {
			case "toggle-scope": {
				const nextScope: ModelScope = this.scope === "all" ? "scoped" : "all";
				this.setScope(nextScope);
				if (this.scopeHintText) {
					this.scopeHintText.setText(this.getScopeHintText());
				}
				return;
			}
			case "move-selection": {
				this.selectedIndex = action.nextIndex;
				this.updateList();
				return;
			}
			case "select-current": {
				const selectedModel = this.filteredModels[this.selectedIndex];
				if (selectedModel) this.handleSelect(selectedModel.model);
				return;
			}
			case "cancel": {
				this.onCancelCallback();
				return;
			}
			case "forward-to-search": {
				this.searchInput.handleInput(keyData);
				this.filterModels(this.searchInput.getValue());
				return;
			}
			default:
				return;
		}
	}

	private handleSelect(model: Model<any>): void {
		// Save as new default
		this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
		this.onSelectCallback(model);
	}

	getSearchInput(): Input {
		return this.searchInput;
	}
}
