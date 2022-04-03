import { AdvancementConfig } from "./advancement-config.js";
import { AdvancementFlow } from "./advancement-flow.js";


/**
 * Abstract base class which various advancement types can subclass.
 *
 * @property {Item5e} parent  Item to which this advancement belongs.
 * @property {object} [data]  Raw data stored in the advancement object.
 */
export class Advancement {

  constructor(parent, data={}) {
    /**
     * Item to which this advancement belongs.
     * @type {Item5e}
     */
    this.parent = parent;

    /**
     * Configuration data for this advancement.
     * @type {object}
     */
    this.data = data;
  }

  /* -------------------------------------------- */

  /**
   * Information on how an advancement type is configured.
   *
   * @typedef {object} AdvancementMetadata
   * @property {object} data
   * @property {object} data.configuration  Default contents of the configuration object for this advancement type.
   * @property {object} data.value          Default contents of the actor value object for this advancement type.
   * @property {number} order          Number used to determine default sorting order of advancement items.
   * @property {string} icon           Icon used for this advancement type if no user icon is specified.
   * @property {string} title          Title to be displayed if no user title is specified.
   * @property {string} hint           Description of this type shown in the advancement selection dialog.
   * @property {boolean} multiLevel    Can this advancement affect more than one level? If this is set to true,
   *                                   the level selection control in the configuration window is hidden and the
   *                                   advancement should provide its own implementation of `Advancement#levels`
   *                                   and potentially its own level configuration interface.
   * @property {object} apps
   * @property {*} apps.config         Subclass of AdvancementConfig that allows for editing of this advancement type.
   * @proeprty {*} apps.flow           Subclass of AdvancementFlow that is displayed while fulfilling this advancement.
   */

  /**
   * Configuration information for this advancement type.
   * @type {AdvancementMetadata}
   */
  static get metadata() {
    return {
      data: {
        configuration: {},
        value: {}
      },
      order: 100,
      icon: "icons/svg/upgrade.svg",
      title: game.i18n.localize("DND5E.AdvancementTitle"),
      hint: "",
      multiLevel: false,
      apps: {
        config: AdvancementConfig,
        flow: AdvancementFlow
      }
    };
  }

  /* -------------------------------------------- */
  /*  Static Properties                           */
  /* -------------------------------------------- */

  /**
   * Name of this advancement type that will be stored in config and used for lookups.
   * @type {string}
   * @protected
   */
  static get typeName() {
    return this.name.replace(/Advancement$/, "");
  }

  /* -------------------------------------------- */

  /**
   * Data structure for a newly created advancement of this type.
   * @type {object}
   * @protected
   */
  static get defaultData() {
    const data = {
      _id: null,
      type: this.typeName,
      configuration: foundry.utils.deepClone(this.metadata.data.configuration),
      value: foundry.utils.deepClone(this.metadata.data.value)
    };
    if ( !this.metadata.multiLevel ) data.level = 1;
    return data;
  }

  /* -------------------------------------------- */
  /*  Instance Properties                         */
  /* -------------------------------------------- */

  /**
   * Unique identifier for this advancement.
   * @type {string}
   */
  get id() {
    return this.data._id;
  }

  /* -------------------------------------------- */

  /**
   * Actor to which this advancement's item belongs, if the item is embedded.
   * @type {Actor5e|null}
   */
  get actor() {
    return this.parent.parent ?? null;
  }

  /* -------------------------------------------- */

  /**
   * Title of this advancement object when level isn't relevant.
   * @type {string}
   */
  get title() {
    return this.data.title || this.constructor.metadata.title;
  }

  /* -------------------------------------------- */

  /**
   * Icon to display in advancement list.
   * @type {string}
   */
  get icon() {
    return this.data.icon || this.constructor.metadata.icon;
  }

  /* -------------------------------------------- */

  /**
   * List of levels in which this advancement object should be displayed. Will be a list of class levels if this
   * advancement is being applied to classes or subclasses, otherwise a list of character levels.
   * @returns {number[]}
   */
  get levels() {
    return this.data.level ? [this.data.level] : [];
  }

  /* -------------------------------------------- */
  /*  Display Methods                             */
  /* -------------------------------------------- */

  /**
   * Has the player made choices for this advancement at the specified level?
   * @param {number} level  Level for which to check configuration.
   * @returns {boolean}     Have any available choices been made?
   */
  configuredForLevel(level) {
    return true;
  }

  /* -------------------------------------------- */

  /**
   * Value used for sorting this advancement at a certain level.
   * @param {number} level  Level for which this entry is being sorted.
   * @returns {string}      String that can be used for sorting.
   */
  sortingValueForLevel(level) {
    return `${this.constructor.metadata.order.paddedString(4)} ${this.titleForLevel(level)}`;
  }

  /* -------------------------------------------- */

  /**
   * Title displayed in advancement list for a specific level.
   * @param {number} level  Level for which to generate a title.
   * @returns {string}      HTML title with any level-specific information.
   */
  titleForLevel(level) {
    return this.title;
  }

  /* -------------------------------------------- */

  /**
   * Summary content displayed beneath the title in the advancement list.
   * @param {number} level  Level for which to generate the summary.
   * @returns {string}      HTML content of the summary.
   */
  summaryForLevel(level) {
    return "";
  }

  /* -------------------------------------------- */
  /*  Editing Methods                             */
  /* -------------------------------------------- */

  /**
   * Update this advancement.
   * @param {object} updates          Updates to apply to this advancement, using the same format as `Document#update`.
   * @returns {Promise<Advancement>}  This advancement after updates have been applied.
   */
  async update(updates) {
    await this.parent.updateAdvancement(this.id, updates);
    this.data = this.parent.advancement[this.id].data;
    return this.parent.advancement[this.id];
  }

  /* -------------------------------------------- */

  /**
   * Update this advancement's data on the item without performing a database commit.
   * @param {object} updates  Updates to apply to this advancement, using the same format as `Document#update`.
   * @returns {Advancement}   This advancement after updates have been applied.
   */
  updateSource(updates) {
    const advancement = foundry.utils.deepClone(this.parent.data.data.advancement);
    const idx = advancement.findIndex(a => a._id === this.id);
    if ( idx < 0 ) throw new Error(`Advancement of ID ${this.id} could not be found to update`);

    foundry.utils.mergeObject(this.data, updates);
    foundry.utils.mergeObject(advancement[idx], updates);
    this.parent.data.update({"data.advancement": advancement});

    return this;
  }

  /* -------------------------------------------- */

  /**
   * Can an advancement of this type be added to an item of the provided type?
   * @param {string} type  Type of the item.
   * @returns {boolean}    Should this be displayed as an option on the `AdvancementSelection` dialog?
   */
  static availableForType(type) {
    return true;
  }

  /* -------------------------------------------- */

  /**
   * Can an advancement of this type be added to the provided item?
   * @param {Item5e} item  Item to check against.
   * @returns {boolean}    Should this be enabled as an option on the `AdvancementSelection` dialog?
   */
  static availableForItem(item) {
    return true;
  }

  /* -------------------------------------------- */
  /*  Application Methods                         */
  /* -------------------------------------------- */

  /**
   * Add any properties that should be changed on the actor to an update object.
   * @param {object} config
   * @param {number} config.level             Level for which to gather updates.
   * @param {object} [config.updates]         Updates to this advancement's `value`. If this is provided, only the
   *                                          difference between this object and the existing value should be applied.
   * @param {boolean} [config.reverse=false]  Whether the reverse changes should be produced.
   * @returns {object}                        The actor updates object.
   */
  propertyUpdates({ level, updates, reverse=false }) {
    return {};
  }

  /* -------------------------------------------- */

  /**
   * Get a list UUIDs for new items that should be added to the actor.
   * @param {object} config
   * @param {number} config.level             Level for which to add items.
   * @param {object} [config.updates]         Updates to this advancement's `value`. If this is provided, only the
   *                                          difference between this object and the existing value should be applied.
   * @param {boolean} [config.reverse=false]  Whether the reverse changes should be produced.
   * @returns {{
   *   add: string[],
   *   remove: string[]
   * }}  UUIDs of items to add to the actor and IDs of items to remove.
   */
  itemUpdates({ level, updates, reverse=false }) {
    return { add: [], remove: [] };
  }

}
