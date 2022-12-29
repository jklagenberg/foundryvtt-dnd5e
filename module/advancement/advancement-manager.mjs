import Advancement from "./advancement.mjs";

/**
 * Internal type used to manage each step within the advancement process.
 *
 * @typedef {object} AdvancementStep
 * @property {string} type                Step type from "forward", "reverse", "restore", or "delete".
 * @property {AdvancementFlow} [flow]     Flow object for the advancement being applied by this step.
 * @property {Item5e} [item]              For "delete" steps only, the item to be removed.
 * @property {object} [class]             Contains data on class if step was triggered by class level change.
 * @property {Item5e} [class.item]        Class item that caused this advancement step.
 * @property {number} [class.level]       Level the class should be during this step.
 * @property {boolean} [automatic=false]  Should the manager attempt to apply this step without user interaction?
 * @property {boolean} [synthetic=false]  Was this step created as a result of an item introduced or deleted?
 */

/**
 * Application for controlling the advancement workflow and displaying the interface.
 *
 * @param {Actor5e} actor        Actor on which this advancement is being performed.
 * @param {object} [options={}]  Additional application options.
 */
export default class AdvancementManager extends Application {
  constructor(actor, options={}) {
    super(options);

    /**
     * The original actor to which changes will be applied when the process is complete.
     * @type {Actor5e}
     */
    this.actor = actor;

    /**
     * A clone of the original actor to which the changes can be applied during the advancement process.
     * @type {Actor5e}
     */
    this.clone = actor.clone();

    /**
     * Individual steps that will be applied in order.
     * @type {object}
     */
    this.steps = [];

    /**
     * Step being currently displayed.
     * @type {number|null}
     * @private
     */
    this._stepIndex = null;

    /**
     * Is the prompt currently advancing through un-rendered steps?
     * @type {boolean}
     * @private
     */
    this._advancing = false;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["dnd5e", "advancement", "flow"],
      template: "systems/dnd5e/templates/advancement/advancement-manager.hbs",
      width: 460,
      height: "auto"
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get title() {
    const visibleSteps = this.steps.filter(s => !s.automatic);
    const visibleIndex = visibleSteps.indexOf(this.step);
    const step = visibleIndex < 0 ? "" : game.i18n.format("DND5E.AdvancementManagerSteps", {
      current: visibleIndex + 1,
      total: visibleSteps.length
    });
    return `${game.i18n.localize("DND5E.AdvancementManagerTitle")} ${step}`;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get id() {
    return `actor-${this.actor.id}-advancement`;
  }

  /* -------------------------------------------- */

  /**
   * Get the step that is currently in progress.
   * @type {object|null}
   */
  get step() {
    return this.steps[this._stepIndex] ?? null;
  }

  /* -------------------------------------------- */

  /**
   * Get the step before the current one.
   * @type {object|null}
   */
  get previousStep() {
    return this.steps[this._stepIndex - 1] ?? null;
  }

  /* -------------------------------------------- */

  /**
   * Get the step after the current one.
   * @type {object|null}
   */
  get nextStep() {
    const nextIndex = this._stepIndex === null ? 0 : this._stepIndex + 1;
    return this.steps[nextIndex] ?? null;
  }

  /* -------------------------------------------- */
  /*  Factory Methods                             */
  /* -------------------------------------------- */

  /**
   * Construct a manager for a newly added item.
   * @param {Actor5e} actor         Actor to which the item is being added.
   * @param {object} itemData       Data for the item being added.
   * @param {object} options        Rendering options passed to the application.
   * @returns {AdvancementManager}  Prepared manager. Steps count can be used to determine if advancements are needed.
   */
  static forNewItem(actor, itemData, options={}) {
    const manager = new this(actor, options);

    // Prepare data for adding to clone
    const dataClone = foundry.utils.deepClone(itemData);
    dataClone._id = foundry.utils.randomID();
    if ( itemData.type === "class" ) {
      dataClone.system.levels = 0;
      if ( !manager.clone.system.details.originalClass ) {
        manager.clone.updateSource({"system.details.originalClass": dataClone._id});
      }
    }

    // Add item to clone & get new instance from clone
    manager.clone.updateSource({items: [dataClone]});
    const clonedItem = manager.clone.items.get(dataClone._id);

    // For class items, prepare level change data
    if ( itemData.type === "class" ) {
      return manager.createLevelChangeSteps(clonedItem, itemData.system?.levels ?? 1);
    }

    // All other items, just create some flows up to current character level (or class level for subclasses)
    let targetLevel = manager.clone.system.details.level;
    if ( clonedItem.type === "subclass" ) targetLevel = clonedItem.class?.system.levels ?? 0;
    Array.fromRange(targetLevel + 1)
      .flatMap(l => this.flowsForLevel(clonedItem, l))
      .forEach(flow => manager.steps.push({ type: "forward", flow }));

    return manager;
  }

  /* -------------------------------------------- */

  /**
   * Construct a manager for modifying choices on an item at a specific level.
   * @param {Actor5e} actor         Actor from which the choices should be modified.
   * @param {object} itemId         ID of the item whose choices are to be changed.
   * @param {number} level          Level at which the choices are being changed.
   * @param {object} options        Rendering options passed to the application.
   * @returns {AdvancementManager}  Prepared manager. Steps count can be used to determine if advancements are needed.
   */
  static forModifyChoices(actor, itemId, level, options) {
    const manager = new this(actor, options);
    const clonedItem = manager.clone.items.get(itemId);
    if ( !clonedItem ) return manager;

    const currentLevel = clonedItem.system.levels ?? clonedItem.class?.system.levels
      ?? manager.clone.system.details.level;

    const flows = Array.fromRange(currentLevel + 1).slice(level)
      .flatMap(l => this.flowsForLevel(clonedItem, l));

    // Revert advancements through changed level
    flows.reverse().forEach(flow => manager.steps.push({ type: "reverse", flow, automatic: true }));

    // Create forward advancements for level being changed
    flows.reverse().filter(f => f.level === level).forEach(flow => manager.steps.push({ type: "forward", flow }));

    // Create restore advancements for other levels
    flows.filter(f => f.level > level).forEach(flow => manager.steps.push({ type: "restore", flow, automatic: true }));

    return manager;
  }

  /* -------------------------------------------- */

  /**
   * Construct a manager for an item that needs to be deleted.
   * @param {Actor5e} actor         Actor from which the item should be deleted.
   * @param {object} itemId         ID of the item to be deleted.
   * @param {object} options        Rendering options passed to the application.
   * @returns {AdvancementManager}  Prepared manager. Steps count can be used to determine if advancements are needed.
   */
  static forDeletedItem(actor, itemId, options) {
    const manager = new this(actor, options);
    const clonedItem = manager.clone.items.get(itemId);
    if ( !clonedItem ) return manager;

    // For class items, prepare level change data
    if ( clonedItem.type === "class" ) {
      return manager.createLevelChangeSteps(clonedItem, clonedItem.system.levels * -1);
    }

    // All other items, just create some flows down from current character level
    Array.fromRange(manager.clone.system.details.level + 1)
      .flatMap(l => this.flowsForLevel(clonedItem, l))
      .reverse()
      .forEach(flow => manager.steps.push({ type: "reverse", flow, automatic: true }));

    // Add a final step to remove the item only if there are advancements to apply
    if ( manager.steps.length ) manager.steps.push({ type: "delete", item: clonedItem, automatic: true });
    return manager;
  }

  /* -------------------------------------------- */

  /**
   * Construct a manager for a change in a class's levels.
   * @param {Actor5e} actor         Actor whose level has changed.
   * @param {string} classId        ID of the class being changed.
   * @param {number} levelDelta     Levels by which to increase or decrease the class.
   * @param {object} options        Rendering options passed to the application.
   * @returns {AdvancementManager}  Prepared manager. Steps count can be used to determine if advancements are needed.
   */
  static forLevelChange(actor, classId, levelDelta, options={}) {
    const manager = new this(actor, options);
    const clonedItem = manager.clone.items.get(classId);
    if ( !clonedItem ) return manager;
    return manager.createLevelChangeSteps(clonedItem, levelDelta);
  }

  /* -------------------------------------------- */

  /**
   * Create steps based on the provided level change data.
   * @param {string} classItem      Class being changed.
   * @param {number} levelDelta     Levels by which to increase or decrease the class.
   * @returns {AdvancementManager}  Manager with new steps.
   * @private
   */
  createLevelChangeSteps(classItem, levelDelta) {
    const pushSteps = (flows, data) => this.steps.push(...flows.map(flow => ({ flow, ...data })));
    const getItemFlows = characterLevel => this.clone.items.contents.flatMap(i => {
      if ( ["class", "subclass"].includes(i.type) ) return [];
      return this.constructor.flowsForLevel(i, characterLevel);
    });

    // Level increased
    for ( let offset = 1; offset <= levelDelta; offset++ ) {
      const classLevel = classItem.system.levels + offset;
      const characterLevel = this.actor.system.details.level + offset;
      const stepData = { type: "forward", class: {item: classItem, level: classLevel} };
      pushSteps(this.constructor.flowsForLevel(classItem, classLevel), stepData);
      pushSteps(this.constructor.flowsForLevel(classItem.subclass, classLevel), stepData);
      pushSteps(getItemFlows(characterLevel), stepData);
    }

    // Level decreased
    for ( let offset = 0; offset > levelDelta; offset-- ) {
      const classLevel = classItem.system.levels + offset;
      const characterLevel = this.actor.system.details.level + offset;
      const stepData = { type: "reverse", class: {item: classItem, level: classLevel}, automatic: true };
      pushSteps(getItemFlows(characterLevel).reverse(), stepData);
      pushSteps(this.constructor.flowsForLevel(classItem.subclass, classLevel).reverse(), stepData);
      pushSteps(this.constructor.flowsForLevel(classItem, classLevel).reverse(), stepData);
      if ( classLevel === 1 ) this.steps.push({ type: "delete", item: classItem, automatic: true });
    }

    // Ensure the class level ends up at the appropriate point
    this.steps.push({
      type: "forward", automatic: true,
      class: {item: classItem, level: classItem.system.levels += levelDelta}
    });

    return this;
  }

  /* -------------------------------------------- */

  /**
   * Creates advancement flows for all advancements at a specific level.
   * @param {Item5e} item          Item that has advancement.
   * @param {number} level         Level in question.
   * @returns {AdvancementFlow[]}  Created flow applications.
   * @protected
   */
  static flowsForLevel(item, level) {
    return (item?.advancement.byLevel[level] ?? [])
      .filter(a => a.appliesToClass)
      .map(a => new a.constructor.metadata.apps.flow(item, a.id, level));
  }

  /* -------------------------------------------- */
  /*  Form Rendering                              */
  /* -------------------------------------------- */

  /** @inheritdoc */
  getData() {
    if ( !this.step ) return {};

    // Prepare information for subheading
    const item = this.step.flow.item;
    let level = this.step.flow.level;
    if ( (this.step.class) && ["class", "subclass"].includes(item.type) ) level = this.step.class.level;

    const visibleSteps = this.steps.filter(s => !s.automatic);
    const visibleIndex = visibleSteps.indexOf(this.step);

    return {
      actor: this.clone,
      flowId: this.step.flow.id,
      header: item.name,
      subheader: level ? game.i18n.format("DND5E.AdvancementLevelHeader", { level }) : "",
      steps: {
        current: visibleIndex + 1,
        total: visibleSteps.length,
        hasPrevious: visibleIndex > 0,
        hasNext: visibleIndex < visibleSteps.length - 1
      }
    };
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  render(...args) {
    if ( this.steps.length && (this._stepIndex === null) ) this._stepIndex = 0;

    // Ensure the level on the class item matches the specified level
    if ( this.step?.class ) {
      let level = this.step.class.level;
      if ( this.step.type === "reverse" ) level -= 1;
      this.step.class.item.updateSource({"system.levels": level});
      this.clone.reset();
    }

    /**
     * A hook event that fires when an AdvancementManager is about to be processed.
     * @function dnd5e.preAdvancementManagerRender
     * @memberof hookEvents
     * @param {AdvancementManager} advancementManager The advancement manager about to be rendered
     */
    const allowed = Hooks.call("dnd5e.preAdvancementManagerRender", this);

    // Abort if not allowed
    if ( allowed === false ) return this;

    if ( this.step?.automatic ) {
      if ( this._advancing ) return this;
      this._forward();
      return this;
    }

    return super.render(...args);
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async _render(force, options) {
    await super._render(force, options);
    if ( (this._state !== Application.RENDER_STATES.RENDERED) || !this.step ) return;

    // Render the step
    this.step.flow._element = null;
    await this.step.flow._render(force, options);
    this.setPosition();
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  activateListeners(html) {
    super.activateListeners(html);
    html.find("button[data-action]").click(event => {
      const buttons = html.find("button");
      buttons.attr("disabled", true);
      html.find(".error").removeClass("error");
      try {
        switch ( event.currentTarget.dataset.action ) {
          case "restart":
            if ( !this.previousStep ) return;
            return this._restart(event);
          case "previous":
            if ( !this.previousStep ) return;
            return this._backward(event);
          case "next":
          case "complete":
            return this._forward(event);
        }
      } finally {
        buttons.attr("disabled", false);
      }
    });
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  async close(options={}) {
    if ( !options.skipConfirmation ) {
      return new Dialog({
        title: `${game.i18n.localize("DND5E.AdvancementManagerCloseTitle")}: ${this.actor.name}`,
        content: game.i18n.localize("DND5E.AdvancementManagerCloseMessage"),
        buttons: {
          close: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("DND5E.AdvancementManagerCloseButtonStop"),
            callback: () => super.close(options)
          },
          continue: {
            icon: '<i class="fas fa-chevron-right"></i>',
            label: game.i18n.localize("DND5E.AdvancementManagerCloseButtonContinue")
          }
        },
        default: "close"
      }).render(true);
    }
    await super.close(options);
  }

  /* -------------------------------------------- */
  /*  Process                                     */
  /* -------------------------------------------- */

  /**
   * Advance through the steps until one requiring user interaction is encountered.
   * @param {Event} [event]  Triggering click event if one occurred.
   * @returns {Promise}
   * @private
   */
  async _forward(event) {
    this._advancing = true;
    try {
      do {
        const flow = this.step.flow;
        const preEmbeddedItems = this.clone.items.map(i => i);

        // Apply changes based on step type
        if ( this.step.type === "delete" ) this.clone.items.delete(this.step.item.id);
        else if ( this.step.type === "restore" ) await flow.advancement.restore(flow.level, flow.retainedData);
        else if ( this.step.type === "reverse" ) flow.retainedData = await flow.advancement.reverse(flow.level);
        else if ( flow ) await flow._updateObject(event, flow._getSubmitData());

        this._synthesizeSteps(preEmbeddedItems);
        this._stepIndex++;

        // Ensure the level on the class item matches the specified level
        if ( this.step?.class ) {
          let level = this.step.class.level;
          if ( this.step.type === "reverse" ) level -= 1;
          this.step.class.item.updateSource({"system.levels": level});
        }
        this.clone.reset();
      } while ( this.step?.automatic );
    } catch(error) {
      if ( !(error instanceof Advancement.ERROR) ) throw error;
      ui.notifications.error(error.message);
      this.step.automatic = false;
      if ( this.step.type === "restore" ) this.step.type = "forward";
    } finally {
      this._advancing = false;
    }

    if ( this.step ) this.render(true);
    else this._complete();
  }

  /* -------------------------------------------- */

  /**
   * Add synthetic steps for any added or removed items with advancement.
   * @param {Item5e[]} preEmbeddedItems  Items present before the current step was applied.
   */
  _synthesizeSteps(preEmbeddedItems) {
    // Build a set of item IDs for non-synthetic steps
    const initialIds = this.steps.reduce((ids, step) => {
      if ( step.synthetic || !step.flow?.item ) return ids;
      ids.add(step.flow.item.id);
      return ids;
    }, new Set());

    const preIds = new Set(preEmbeddedItems.map(i => i.id));
    const postIds = new Set(this.clone.items.map(i => i.id));
    const addedIds = postIds.difference(preIds).difference(initialIds);
    const deletedIds = preIds.difference(postIds).difference(initialIds);

    for ( const addedId of addedIds ) {
      const item = this.clone.items.get(addedId);
      if ( !item.hasAdvancement ) continue;

      let handledLevel = 0;
      for ( let idx = this._stepIndex; idx < this.steps.length; idx++ ) {
        // Find spots where the level increases
        const thisLevel = this.steps[idx].flow?.level || this.steps[idx].class?.level;
        const nextLevel = this.steps[idx + 1]?.flow?.level || this.steps[idx + 1]?.class?.level;
        if ( (thisLevel <= handledLevel) || (thisLevel === nextLevel) ) continue;

        // Determine if there is any advancement to be done for the added item to this level
        // from the previously handled level
        const steps = Array.fromRange(thisLevel - handledLevel + 1, handledLevel)
          .flatMap(l => this.constructor.flowsForLevel(item, l))
          .map(flow => ({ type: "forward", flow, synthetic: true }));

        // Add new steps at the end of the level group
        this.steps.splice(idx + 1, 0, ...steps);
        idx += steps.length;

        handledLevel = nextLevel ?? handledLevel;
      }
    }

    if ( (this.step.type === "delete") && this.step.synthetic ) return;
    for ( const deletedId of deletedIds ) {
      let item = preEmbeddedItems.find(i => i.id === deletedId);
      if ( !item?.hasAdvancement ) continue;

      // Temporarily add the item back
      this.clone.updateSource({items: [item.toObject()]});
      item = this.clone.items.get(item.id);

      // Check for advancement from the maximum level handled by this manager to zero
      let steps = [];
      Array.fromRange(this.clone.system.details.level + 1)
        .flatMap(l => this.constructor.flowsForLevel(item, l))
        .reverse()
        .forEach(flow => steps.push({ type: "reverse", flow, automatic: true, synthetic: true }));

      // Add a new remove item step to the end of the synthetic steps to finally get rid of this item
      steps.push({ type: "delete", item, automatic: true, synthetic: true });

      // Add new steps after the current step
      this.steps.splice(this._stepIndex + 1, 0, ...steps);
    }
  }

  /* -------------------------------------------- */

  /**
   * Reverse through the steps until one requiring user interaction is encountered.
   * @param {Event} [event]                  Triggering click event if one occurred.
   * @param {object} [options]               Additional options to configure behavior.
   * @param {boolean} [options.render=true]  Whether to render the Application after the step has been reversed. Used
   *                                         by the restart workflow.
   * @returns {Promise}
   * @private
   */
  async _backward(event, { render=true }={}) {
    this._advancing = true;
    try {
      do {
        this._stepIndex--;
        if ( !this.step ) break;
        const flow = this.step.flow;
        const preEmbeddedItems = this.clone.items.map(i => i);

        // Reverse step based on step type
        if ( this.step.type === "delete" ) this.clone.updateSource({items: [this.step.item]});
        else if ( this.step.type === "reverse" ) await flow.advancement.restore(flow.level, flow.retainedData);
        else if ( flow ) flow.retainedData = await flow.advancement.reverse(flow.level);

        this._clearSyntheticSteps(preEmbeddedItems);
        this.clone.reset();
      } while ( this.step?.automatic );
    } catch(error) {
      if ( !(error instanceof Advancement.ERROR) ) throw error;
      ui.notifications.error(error.message);
      this.step.automatic = false;
    } finally {
      this._advancing = false;
    }

    if ( !render ) return;
    if ( this.step ) this.render(true);
    else this.close({ skipConfirmation: true });
  }

  /* -------------------------------------------- */

  /**
   * Remove synthetic steps for any added or removed items.
   * @param {Item5e[]} preEmbeddedItems  Items present before the current step was applied.
   */
  _clearSyntheticSteps(preEmbeddedItems) {
    // Create a disjoint union of the before and after items
    const preIds = new Set(preEmbeddedItems.map(i => i.id));
    const postIds = new Set(this.clone.items.map(i => i.id));
    const modifiedIds = postIds.difference(preIds);
    preIds.difference(postIds).forEach(id => modifiedIds.add(id));

    // Remove any synthetic steps after the current step if their item has been modified
    for ( const [idx, element] of Array.from(this.steps.entries()).reverse() ) {
      if ( idx <= this._stepIndex ) break;
      if ( element.synthetic && modifiedIds.has(element.flow?.item?.id) ) this.steps.splice(idx, 1);
    }
  }

  /* -------------------------------------------- */

  /**
   * Reset back to the manager's initial state.
   * @param {MouseEvent} [event]  The triggering click event if one occurred.
   * @returns {Promise}
   * @private
   */
  async _restart(event) {
    const restart = await Dialog.confirm({
      title: game.i18n.localize("DND5E.AdvancementManagerRestartConfirmTitle"),
      content: game.i18n.localize("DND5E.AdvancementManagerRestartConfirm")
    });
    if ( !restart ) return;
    // While there is still a renderable step.
    while ( this.steps.slice(0, this._stepIndex).some(s => !s.automatic) ) {
      await this._backward(event, {render: false});
    }
    this.render(true);
  }

  /* -------------------------------------------- */

  /**
   * Apply changes to actual actor after all choices have been made.
   * @param {Event} event  Button click that triggered the change.
   * @returns {Promise}
   * @private
   */
  async _complete(event) {
    const updates = this.clone.toObject();
    const items = updates.items;
    delete updates.items;

    // Gather changes to embedded items
    const { toCreate, toUpdate, toDelete } = items.reduce((obj, item) => {
      if ( !this.actor.items.get(item._id) ) {
        obj.toCreate.push(item);
      } else {
        obj.toUpdate.push(item);
        obj.toDelete.findSplice(id => id === item._id);
      }
      return obj;
    }, { toCreate: [], toUpdate: [], toDelete: this.actor.items.map(i => i.id) });

    /**
     * A hook event that fires at the final stage of a character's advancement process, before actor and item updates
     * are applied.
     * @function dnd5e.preAdvancementManagerComplete
     * @memberof hookEvents
     * @param {AdvancementManager} advancementManager  The advancement manager.
     * @param {object} actorUpdates                    Updates to the actor.
     * @param {object[]} toCreate                      Items that will be created on the actor.
     * @param {object[]} toUpdate                      Items that will be updated on the actor.
     * @param {string[]} toDelete                      IDs of items that will be deleted on the actor.
     */
    if ( Hooks.call("dnd5e.preAdvancementManagerComplete", this, updates, toCreate, toUpdate, toDelete) === false ) {
      console.log("AdvancementManager completion was prevented by the 'preAdvancementManagerComplete' hook.");
      return this.close({ skipConfirmation: true });
    }

    // Apply changes from clone to original actor
    await Promise.all([
      this.actor.update(updates, { isAdvancement: true }),
      this.actor.createEmbeddedDocuments("Item", toCreate, { keepId: true, isAdvancement: true }),
      this.actor.updateEmbeddedDocuments("Item", toUpdate, { isAdvancement: true }),
      this.actor.deleteEmbeddedDocuments("Item", toDelete, { isAdvancement: true })
    ]);

    /**
     * A hook event that fires when an AdvancementManager is done modifying an actor.
     * @function dnd5e.advancementManagerComplete
     * @memberof hookEvents
     * @param {AdvancementManager} advancementManager The advancement manager that just completed
     */
    Hooks.callAll("dnd5e.advancementManagerComplete", this);

    // Close prompt
    return this.close({ skipConfirmation: true });
  }

}
