import * as Filter from "../filter.mjs";

const ApplicationV2 = foundry.applications?.api?.ApplicationV2 ?? (class {});
const HandlebarsApplicationMixin = foundry.applications?.api?.HandlebarsApplicationMixin ?? (cls => cls);

/**
 * @typedef {object} CompendiumBrowserFilters
 * @property {string} [documentClass]  Document type to fetch (e.g. Actor or Item).
 * @property {Set<string>} [types]     Individual document subtypes to filter upon (e.g. "loot", "class", "npc").
 * @property {object} [additional]     Additional type-specific filters applied.
 */

/**
 * Filter definition object for additional filters in the Compendium Browser.
 *
 * @typedef {object} CompendiumBrowserFilterDefinitionEntry
 * @property {string} label                                   Localizable label for the filter.
 * @property {"boolean"|"range"|"set"} type                   Type of filter control to display.
 * @property {object} config                                  Type-specific configuration data.
 * @property {CompendiumBrowserCreateFilters} [createFilter]  Method that can be called to create filters.
 */

/**
 * @callback CompendiumBrowserFilterCreateFilters
 * @param {FilterDescription[]} filters                        Array of filters to be applied that should be mutated.
 * @param {*} value                                            Value of the filter.
 * @param {CompendiumBrowserFilterDefinitionEntry} definition  Definition for this filter.
 */

/**
 * @typedef {Map<string, CompendiumBrowserFilterDefinitionEntry>} CompendiumBrowserFilterDefinition
 */

/**
 * Application for browsing, filtering, and searching for content between multiple compendiums.
 * @extends ApplicationV2
 * @mixes HandlebarsApplicationMixin
 */
export default class CompendiumBrowser extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(...args) {
    if ( game.release.generation < 12 ) throw Error("Compendium Browser only works in Foundry V12 or later");
    super(...args);

    this.#filters = this.options.filters?.initial ?? {};
  }

  /* -------------------------------------------- */

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "compendium-browser-{id}",
    classes: ["dnd5e2", "compendium-browser"],
    tag: "form",
    window: {
      title: "DND5E.CompendiumBrowser.Title",
      icon: "fa-solid fa-book-open-reader",
      minimizable: true,
      resizable: true
    },
    actions: {
      openLink: CompendiumBrowser.#onOpenLink,
      setFilter: CompendiumBrowser.#onSetFilter,
      setType: CompendiumBrowser.#onSetType,
      toggleCollapse: CompendiumBrowser.#onToggleCollapse
    },
    position: {
      width: 1024,
      height: 640
    },
    filters: {
      locked: {},
      initial: {
        documentClass: "Item"
      }
    }
  };

  /* -------------------------------------------- */

  /** @override */
  static PARTS = {
    documentClass: {
      id: "sidebar-class",
      classes: ["sidebar-part"],
      template: "systems/dnd5e/templates/compendium/browser-sidebar-class.hbs"
    },
    types: {
      id: "sidebar-types",
      classes: ["sidebar-part"],
      template: "systems/dnd5e/templates/compendium/browser-sidebar-types.hbs"
    },
    filters: {
      id: "sidebar-filters",
      classes: ["sidebar-part"],
      template: "systems/dnd5e/templates/compendium/browser-sidebar-filters.hbs"
    },
    results: {
      id: "results",
      classes: ["results"],
      template: "systems/dnd5e/templates/compendium/browser-results.hbs",
      templates: ["systems/dnd5e/templates/compendium/browser-entry.hbs"],
      scrollable: [""]
    },
    footer: {
      id: "footer",
      classes: ["footer"],
      template: "systems/dnd5e/templates/compendium/browser-footer.hbs"
    }
  };

  /* -------------------------------------------- */
  /*  Properties                                  */
  /* -------------------------------------------- */

  /**
   * Currently define filters.
   */
  #filters;

  /**
   * Current filters selected.
   * @type {CompendiumBrowserFilters}
   */
  get currentFilters() {
    const filters = foundry.utils.mergeObject(
      this.#filters,
      this.options.filters.locked,
      { inplace: false }
    );
    filters.documentClass ??= "Item";
    return filters;
  }

  /* -------------------------------------------- */

  /**
   * Fetched results.
   * @type {Promise<object[]|Document[]>}
   */
  #results;

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  _onFirstRender(context, options) {
    const sidebar = document.createElement("div");
    sidebar.classList.add("sidebar", "flexcol");
    sidebar.replaceChildren(...this.element.querySelectorAll(".sidebar-part"));
    this.element.querySelector(".window-content").insertAdjacentElement("afterbegin", sidebar);
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _preparePartContext(partId, context, options) {
    await super._preparePartContext(partId, context, options);
    switch ( partId ) {
      case "documentClass":
      case "types":
      case "filters": return this._prepareSidebarContext(partId, context, options);
      case "results": return this._prepareResultsContext(context, options);
    }
    return context;
  }

  /* -------------------------------------------- */

  /**
   * Prepare the sidebar context.
   * @param {string} partId                        The part being rendered.
   * @param {ApplicationRenderContext} context     Shared context provided by _prepareContext.
   * @param {HandlebarsRenderOptions} options      Options which configure application rendering behavior.
   * @returns {Promise<ApplicationRenderContext>}  Context data for a specific part.
   * @protected
   */
  async _prepareSidebarContext(partId, context, options) {
    context.filters = this.currentFilters;
    context.isLocked = {};
    context.isLocked.filters = ("additional" in this.options.filters.locked);
    context.isLocked.types = ("types" in this.options.filters.locked) || context.isLocked.filters;
    context.isLocked.documentClass = ("documentClass" in this.options.filters.locked) || context.isLocked.types;

    if ( partId === "types" ) {
      context.types = CONFIG[context.filters.documentClass].documentClass.compendiumBrowserTypes({
        chosen: context.filters.types
      });
      if ( context.isLocked.types ) {
        for ( const [key, value] of Object.entries(context.types) ) {
          if ( !value.children && !value.chosen ) delete context.types[key];
          else if ( value.children ) {
            for ( const [k, v] of Object.entries(value.children) ) {
              if ( !v.chosen ) delete value.children[k];
            }
            if ( foundry.utils.isEmpty(value.children) ) delete context.types[key];
          }
        }
      }
    }

    else if ( partId === "filters" ) {
      let dataModels = Object.entries(CONFIG[context.filters.documentClass].dataModels);
      if ( context.filters.types?.size ) dataModels = dataModels.filter(([type]) => context.filters.types.has(type));
      context.additional = dataModels
        .map(([, d]) => d.compendiumBrowserFilters ?? new Map())
        .reduce((first, second) => {
          if ( !first ) return second;
          return CompendiumBrowser.intersectFilters(first, second);
        }, null);
      for ( const [key, data] of context.additional?.entries() ?? [] ) {
        data.value = context.filters.additional?.[key];
        data.locked = this.options.filters.locked?.additional?.[key];
      }
      // Convert into object because Handlebars' {{each}} helper doesn't properly handle iterating over maps
      context.additional = Object.fromEntries(context.additional?.entries() ?? []);
    }

    return context;
  }

  /* -------------------------------------------- */

  /**
   * Prepare the results context.
   * @param {ApplicationRenderContext} context     Shared context provided by _prepareContext.
   * @param {HandlebarsRenderOptions} options      Options which configure application rendering behavior.
   * @returns {Promise<ApplicationRenderContext>}  Context data for a specific part.
   * @protected
   */
  async _prepareResultsContext(context, options) {
    const currentFilters = this.currentFilters;
    const filterDefinitions = CONFIG[currentFilters.documentClass].dataModels[currentFilters.types?.first()]
      ?.compendiumBrowserFilters ?? new Map();
    // TODO: Determine if new set of results need to be fetched, otherwise use old results and re-sort as necessary
    // Sorting changes alone shouldn't require a re-fetch, but any change to filters will
    this.#results = CompendiumBrowser.fetch(
      CONFIG[currentFilters.documentClass].documentClass,
      {
        types: currentFilters.types,
        filters: CompendiumBrowser.applyFilters(filterDefinitions, currentFilters.additional)
      }
    );
    return context;
  }

  /* -------------------------------------------- */

  /**
   * Render results once loaded to avoid holding up initial app display.
   * @protected
   */
  async _renderResults() {
    let rendered = [];
    for ( const entry of await this.#results ) {
      const context = {
        img: entry.img ?? game.dnd5e.moduleArt.map.get(entry.uuid.replace("Actor.", ""))?.actor,
        entry
      };
      rendered.push(
        renderTemplate("systems/dnd5e/templates/compendium/browser-entry.hbs", context)
          .then(html => {
            const template = document.createElement("template");
            template.innerHTML = html;
            const element = template.content.firstElementChild;
            element.dataset.tooltip = `
              <section class="loading" data-uuid="${entry.uuid}">
                <i class="fa-solid fa-spinner fa-spin-pulse" inert></i>
              </section>
            `;
            element.dataset.tooltipClass = "dnd5e2 dnd5e-tooltip item-tooltip";
            element.dataset.tooltipDirection ??= "RIGHT";
            return element;
          })
      );
    }
    this.element.querySelector('[data-application-part="results"] tbody')
      .replaceChildren(...(await Promise.all(rendered)));
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /** @inheritDoc */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    if ( partId === "results" ) this._renderResults();
    else if ( partId === "types" ) this.#adjustCheckboxStates(htmlElement);
  }

  /* -------------------------------------------- */

  /**
   * Adjust the states of group checkboxes to make then indeterminate if only some of their children are selected.
   * @param {HTMLElement} htmlElement  Element within which to find groups.
   */
  #adjustCheckboxStates(htmlElement) {
    for ( const groupArea of htmlElement.querySelectorAll(".type-group") ) {
      const group = groupArea.querySelector('.type-group-header input[type="checkbox"]');
      const children = groupArea.querySelectorAll('.wrapper input[type="checkbox"]');
      if ( Array.from(children).every(e => e.checked) ) {
        group.checked = true;
        group.indeterminate = false;
      } else {
        group.checked = group.indeterminate = Array.from(children).some(e => e.checked);
      }
    }
  }

  /* -------------------------------------------- */

  /** @override */
  _onChangeForm(formConfig, event) {
    if ( event.target.name?.startsWith("additional.") ) CompendiumBrowser.#onSetFilter.call(this, event, event.target);
  }

  /* -------------------------------------------- */

  /**
   * Handle opening a link to an item.
   * @this {CompendiumBrowser}
   * @param {PointerEvent} event  The originating click event.
   * @param {HTMLElement} target  The capturing HTML element which defined a [data-action].
   */
  static async #onOpenLink(event, target) {
    (await fromUuid(target.closest("[data-uuid]")?.dataset.uuid))?.sheet?.render(true);
  }

  /* -------------------------------------------- */

  /**
   * Handle setting the document class or a filter.
   * @this {CompendiumBrowser}
   * @param {PointerEvent} event  The originating click event.
   * @param {HTMLElement} target  The capturing HTML element which defined a [data-action].
   */
  static async #onSetFilter(event, target) {
    const name = target.name;
    const value = target.value;
    const existingValue = foundry.utils.getProperty(this.#filters, name);
    if ( value === existingValue ) return;
    foundry.utils.setProperty(this.#filters, name, value === "" ? undefined : value);

    if ( target.tagName === "BUTTON" ) for ( const button of this.element.querySelectorAll(`[name="${name}"]`) ) {
      button.ariaPressed = button.value === value;
    }

    const parts = ["results"];
    if ( name === "documentClass" ) {
      parts.push("filters", "types");
      delete this.#filters.additional;
      delete this.#filters.types;
    }
    this.render({ parts });
  }

  /* -------------------------------------------- */

  /**
   * Handle setting a type restriction.
   * @this {CompendiumBrowser}
   * @param {PointerEvent} event  The originating click event.
   * @param {HTMLElement} target  The capturing HTML element which defined a [data-action].
   */
  static async #onSetType(event, target) {
    this.#filters.types ??= new Set();

    if ( target.defaultValue ) {
      if ( target.checked ) this.#filters.types.add(target.defaultValue);
      else this.#filters.types.delete(target.defaultValue);
      this.#adjustCheckboxStates(target.closest(".sidebar"));
    }

    else {
      for ( const child of target.closest(".type-group").querySelectorAll('input[type="checkbox"][value]') ) {
        child.checked = target.checked;
        if ( target.checked ) this.#filters.types.add(child.defaultValue);
        else this.#filters.types.delete(child.defaultValue);
      }
    }

    this.render({ parts: ["filters", "results"] });
  }

  /* -------------------------------------------- */

  /**
   * Handle toggling the collapsed state of a collapsible section.
   * @this {CompendiumBrowser}
   * @param {PointerEvent} event  The originating click event.
   * @param {HTMLElement} target  The capturing HTML element which defined a [data-action].
   */
  static async #onToggleCollapse(event, target) {
    target.closest(".collapsible")?.classList.toggle("collapsed");
  }

  /* -------------------------------------------- */
  /*  Database Access                             */
  /* -------------------------------------------- */

  /**
   * Retrieve a listing of documents from all compendiums for a specific Document type, with additional filters
   * optionally applied.
   * @param {typeof Document} documentClass  Document type to fetch (e.g. Actor or Item).
   * @param {object} [options={}]
   * @param {Set<string>} [options.types]    Individual document subtypes to filter upon (e.g. "loot", "class", "npc").
   * @param {FilterDescription[]} [options.filters]  Filters to provide further filters.
   * @param {boolean} [options.index=true]   Should only the index for each document be returned, or the whole thing?
   * @param {Set<string>} [options.indexFields]  Key paths for fields to index.
   * @param {boolean|string|Function} [options.sort=true]  Should the contents be sorted? By default sorting will be
   *                                         performed using document names, but a key path can be provided to sort on
   *                                         a specific property or a function to provide more advanced sorting.
   * @returns {object[]|Document[]}
   */
  static async fetch(documentClass, { types=new Set(), filters=[], index=true, indexFields=new Set(), sort=true }={}) {
    // Nothing within containers should be shown
    filters.push({ k: "system.container", o: "in", v: [null, undefined] });

    // If filters are provided, merge their keys with any other fields needing to be indexed
    if ( filters.length ) indexFields = indexFields.union(Filter.uniqueKeys(filters));

    // Iterate over all packs
    let documents = game.packs

      // Skip packs that have the wrong document class
      .filter(p => (p.metadata.type === documentClass.metadata.name)

      // TODO: Filter packs by visibility & system setting

        // And if types are set and specified in compendium flag, only include those that include the correct types
        && (!types.size || !p.metadata.flags.dnd5e?.types || new Set(p.metadata.flags.dnd5e.types).intersects(types)))

      // Generate an index based on the needed fields
      .map(async p => await Promise.all((await p.getIndex({ fields: Array.from(indexFields) }))

        // Remove any documents that don't match the specified types or the provided filters
        .filter(i => (!types.size || types.has(i.type)) && (!filters.length || Filter.performCheck(i, filters)))

        // If full documents are required, retrieve those, otherwise stick with the indices
        .map(async i => index ? i : await fromUuid(i.uuid))
      ));

    // Wait for everything to finish loading and flatten the arrays
    documents = (await Promise.all(documents)).flat();

    if ( sort ) {
      if ( sort === true ) sort = "name";
      const sortFunc = foundry.utils.getType(sort) === "function" ? sort : (lhs, rhs) => {
        return String(foundry.utils.getProperty(lhs, sort)).localeCompare(String(foundry.utils.getProperty(rhs, sort)));
      };
      documents.sort(sortFunc);
    }

    return documents;
  }

  /* -------------------------------------------- */
  /*  Helpers                                     */
  /* -------------------------------------------- */

  /**
   * Transform filter definition and additional filters values into the final filters to apply.
   * @param {CompendiumBrowserFilterDefinition} definition  Filter definition provided by type.
   * @param {object} values                                 Values of currently selected filters.
   * @returns {FilterDescription[]}
   */
  static applyFilters(definition, values) {
    const filters = [];
    for ( const [key, value] of Object.entries(values ?? {}) ) {
      const def = definition.get(key);
      if ( !def ) continue;
      if ( foundry.utils.getType(def.createFilter) === "function" ) {
        def.createFilter(filters, value, def);
        continue;
      }
      switch ( def.type ) {
        case "range":
          const min = Number(value.min);
          const max = Number(value.max);
          if ( Number.isFinite(min) ) filters.push({ k: def.config.keyPath, o: "gte", v: min });
          if ( Number.isFinite(max) ) filters.push({ k: def.config.keyPath, o: "lte", v: max });
          break;
        case "set":
          const [positive, negative] = Object.entries(value ?? {}).reduce(([positive, negative], [k, v]) => {
            if ( k === "_blank" ) k = "";
            if ( v === 1 ) positive.push(k);
            else if ( v === -1 ) negative.push(k);
            return [positive, negative];
          }, [[], []]);
          if ( positive.length ) filters.push(
            { k: def.config.keyPath, o: def.config.multiple ? "hasAll" : "in", v: positive }
          );
          if ( negative.length ) filters.push(
            { o: "NOT", v: { k: def.config.keyPath, o: def.config.multiple ? "hasAny" : "in", v: negative } }
          );
          break;
        default:
          console.warn(`Filter type ${def.type} not handled.`);
          break;
      }
    }
    return filters;
  }

  /* -------------------------------------------- */

  /**
   * Inject the compendium browser button into the compendium sidebar.
   * @param {HTMLElement} html  HTML of the sidebar being rendered.
   */
  static injectSidebarButton(html) {
    if ( game.release.generation < 12 ) return;
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("open-compendium-browser");
    button.innerHTML = `
      <i class="fa-solid fa-book-open-reader" inert></i>
      ${game.i18n.localize("DND5E.CompendiumBrowser.Action.Open")}
    `;
    button.addEventListener("click", event => (new CompendiumBrowser()).render({ force: true }));

    const headerActions = html.querySelector(".header-actions");
    headerActions.append(button);
  }

  /* -------------------------------------------- */

  /**
   * Take two filter sets and find only the filters that match between the two.
   * @param {CompendiumBrowserFilterDefinition} first
   * @param {CompendiumBrowserFilterDefinition>} second
   * @returns {CompendiumBrowserFilterDefinition}
   */
  static intersectFilters(first, second) {
    const final = new Map();

    // Iterate over all keys in first map
    for ( const [key, firstConfig] of first.entries() ) {
      const secondConfig = second.get(key);
      if ( firstConfig.type !== secondConfig?.type ) continue;
      const finalConfig = foundry.utils.deepClone(firstConfig);

      switch (firstConfig.type) {
        case "range":
          if ( ("min" in firstConfig.config) || ("min" in secondConfig.config) ) {
            if ( !("min" in firstConfig.config) || !("min" in secondConfig.config) ) continue;
            finalConfig.config.min = Math.max(firstConfig.config.min, secondConfig.config.min);
          }
          if ( ("max" in firstConfig.config) || ("max" in secondConfig.config) ) {
            if ( !("max" in firstConfig.config) || !("max" in secondConfig.config) ) continue;
            finalConfig.config.max = Math.min(firstConfig.config.max, secondConfig.config.max);
          }
          if ( ("min" in finalConfig.config) && ("max" in finalConfig.config)
            && (finalConfig.config.min > finalConfig.config.max) ) continue;
          break;
        case "set":
          Object.keys(finalConfig.config.choices).forEach(k => {
            if ( !(k in firstConfig.config.choices) || !(k in secondConfig.config.choices) ) {
              delete finalConfig.config.choices[k];
            }
          });
          if ( foundry.utils.isEmpty(finalConfig.config.choices) ) continue;
          break;
      }

      final.set(key, finalConfig);
    }
    return final;
  }
}
