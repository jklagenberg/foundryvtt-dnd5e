/**
 * Base class for the advancement interface displayed by the advancement manager that should be subclassed by
 * individual advancement types.
 *
 * @property {Advancement} advancement  Advancement to which this flow belongs.
 * @property {number} level             Level for which to configure this flow.
 * @extends {Application}
 */
export class AdvancementFlow extends Application {

  constructor(advancement, level, options={}) {
    super(options);

    /**
     * Advancement to which this flow belongs.
     * @type {Advancement}
     */
    this.advancement = advancement;

    /**
     * Level for which to configure this flow.
     * @type {number}
     */
    this.level = level;
    
    /**
     * Section of this advancement within the UI.
     * @type {Element|null}
     */
    this.form = null;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      popOut: false
    });
  }

  /* -------------------------------------------- */

  /**
   * Title that will be displayed in the advancement manager.
   * @type {string}
   */
  get title() {
    return this.advancement.title;
  }

  /* -------------------------------------------- */

  /**
   * Sorting value used for ordering this flow within the advancement manager.
   * @type {string}
   */
  get sortingValue() {
    return this.advancement.sortingValueForLevel(this.level);
  }

  /* -------------------------------------------- */

  /**
   * Prepare the data that will be passed to this flow's template.
   * @returns {object}  Data object for the template.
   */
  getData() {
    return { advancement: this.advancement, title: this.title, level: this.level };
  }

  /* -------------------------------------------- */

  /**
   * Add event listeners to the flow's html for dynamic interfaces.
   * @param {jQuery} html  HTML of the flow's section.
   */
  activateListeners(html) { }

  /* -------------------------------------------- */

  /**
   * Perform any steps to prepare the form data to be saved within advancement values.
   * @param {object} formData  Data object taken from the form.
   * @returns {object}         Data formatted to be applied as an update to `Advancement#data.value`.
   */
  prepareUpdate(formData) {
    return formData;
  }

  /* -------------------------------------------- */

  /**
   * Perform any final transformation necessary on the value updates after items have been added.
   * @param {object} update        Value update data provided by `AdvancementFlow#prepareUpdate`.
   * @param {Item5e[]} itemsAdded  Any items added to the actor.
   * @returns {object}             Final value updates to apply to the advancement.
   */
  finalizeUpdate(update, itemsAdded) {
    return update;
  }

  /* -------------------------------------------- */

  /**
   * Provide the update data needed to remove stored value data for this level.
   * @returns {object}  Update object to remove any stored value.
   */
  reverseUpdate() {
    return {};
  }

}
