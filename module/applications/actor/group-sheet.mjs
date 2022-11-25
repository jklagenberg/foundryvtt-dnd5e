import ActorMovementConfig from "./movement-config.mjs";

/**
 * A character sheet for group-type Actors.
 * The functionality of this sheet is sufficiently different from other Actor types that we extend the base
 * Foundry VTT ActorSheet instead of the ActorSheet5e abstraction used for character, npc, and vehicle types.
 */
export default class GroupActorSheet extends ActorSheet {

  /** @inheritDoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["dnd5e", "sheet", "actor", "group"],
      template: "systems/dnd5e/templates/actors/group-sheet.hbs",
      tabs: [{navSelector: ".tabs", contentSelector: ".sheet-body", initial: "members"}],
      width: 620,
      height: 620
    });
  }

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  /** @inheritDoc */
  async getData(options={}) {
    const context = super.getData(options);
    context.system = context.data.system;

    // Membership
    const {sections, stats} = this.#prepareMembers();
    Object.assign(context, stats);
    context.sections = sections;

    // Movement
    context.movement = this.#prepareMovementSpeed();

    // Inventory
    context.inventory = this.#prepareInventory(context.items);
    context.inventoryFilters = false;
    context.rollableClass = this.isEditable ? "rollable" : "";

    // Biography HTML
    context.descriptionFull = await TextEditor.enrichHTML(this.actor.system.description.full, {
      secrets: this.actor.isOwner,
      rollData: context.rollData,
      async: true,
      relativeTo: this.actor
    });

    // Summary tag
    context.summary = game.i18n.format("DND5E.GroupSummary", {
      members: [
        stats.nMembers ? `${stats.nMembers} ${game.i18n.localize("DND5E.GroupMembers")}` : "",
        stats.nVehicles ? `${stats.nVehicles} ${game.i18n.localize("DND5E.GroupVehicles")}` : ""
      ].filterJoin(` ${game.i18n.localize("and")} `)
    });

    // Text labels
    context.labels = {
      currencies: Object.entries(CONFIG.DND5E.currencies).reduce((obj, [k, c]) => {
        obj[k] = c.label;
        return obj;
      }, {})
    };
    return context;
  }

  /* -------------------------------------------- */

  /**
   * Prepare membership data for the sheet.
   * @returns {{sections: object, stats: object}}
   */
  #prepareMembers() {
    const stats = {
      currentHP: 0,
      maxHP: 0,
      nMembers: 0,
      nVehicles: 0
    };
    const sections = {
      character: {label: "Player Characters", members: []},
      npc: {label: "Non-Player Characters", members: []},
      vehicle: {label: "Vehicles", members: []}
    };
    for ( const member of this.object.system.members ) {
      const m = {
        actor: member,
        id: member.id,
        name: member.name,
        img: member.img,
        hp: {},
        displayHPValues: member.testUserPermission(game.user, "OBSERVER")
      };

      // HP bar
      const hp = member.system.attributes.hp;
      m.hp.current = hp.value + (hp.temp || 0);
      m.hp.max = hp.max + (hp.tempmax || 0);
      m.hp.pct = Math.clamped((m.hp.current / m.hp.max) * 100, 0, 100).toFixed(2);
      m.hp.color = dnd5e.documents.Actor5e.getHPColor(m.hp.current, m.hp.max).css;
      stats.currentHP += m.hp.current;
      stats.maxHP += m.hp.max;

      if ( member.type !== "vehicle" ) stats.nMembers++;
      else stats.nVehicles++;
      sections[member.type].members.push(m);
    }
    for ( const [k, section] of Object.entries(sections) ) {
      if ( !section.members.length ) delete sections[k];
    }
    return {sections, stats};
  }

  /* -------------------------------------------- */

  /**
   * Prepare movement speed data for rendering on the sheet.
   * @returns {{secondary: string, primary: string}}
   */
  #prepareMovementSpeed() {
    const movement = this.object.system.attributes.movement;
    let speeds = [
      [movement.land, `${game.i18n.localize("DND5E.MovementLand")} ${movement.land}`],
      [movement.water, `${game.i18n.localize("DND5E.MovementWater")} ${movement.water}`],
      [movement.air, `${game.i18n.localize("DND5E.MovementAir")} ${movement.air}`]
    ];
    speeds = speeds.filter(s => !!s[0]).sort((a, b) => b[0] - a[0]);
    const primary = speeds.shift();
    return {
      primary: `${primary ? primary[1] : "0"}`,
      secondary: speeds.map(s => s[1]).join(", ")
    };
  }

  /* -------------------------------------------- */

  /**
   * Prepare inventory items for rendering on the sheet.
   * @param {object[]} items      Prepared rendering data for owned items
   * @returns {Object<string,object>}
   */
  #prepareInventory(items) {

    // Categorize as weapons, equipment, containers, and loot
    const sections = {
      weapon: {label: "DND5E.ItemTypeWeaponPl", items: [], hasActions: false, dataset: {type: "weapon"}},
      equipment: {label: "DND5E.ItemTypeEquipmentPl", items: [], hasActions: false, dataset: {type: "equipment"}},
      consumable: {label: "DND5E.ItemTypeConsumablePl", items: [], hasActions: false, dataset: {type: "consumable"}},
      backpack: {label: "DND5E.ItemTypeContainerPl", items: [], hasActions: false, dataset: {type: "backpack"}},
      loot: {label: "DND5E.ItemTypeLootPl", items: [], hasActions: false, dataset: {type: "loot"}}
    };

    // Classify items
    for ( const item of items ) {
      const {quantity} = item.system;
      item.isStack = Number.isNumeric(quantity) && (quantity > 1);
      item.canToggle = false;
      if ( (item.type in sections) && (item.type !== "loot") ) sections[item.type].items.push(item);
      else sections.loot.items.push(item);
    }
    return sections;
  }

  /* -------------------------------------------- */
  /*  Rendering Workflow                          */
  /* -------------------------------------------- */

  /** @inheritDoc */
  async _render(force, options={}) {
    for ( const member of this.object.system.members) {
      member.apps[this.id] = this;
    }
    return super._render(force, options);
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async close(options={}) {
    for ( const member of this.object.system.members ) {
      delete member.apps[this.id];
    }
    return super.close(options);
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /** @inheritDoc */
  activateListeners(html) {
    super.activateListeners(html);
    html.find(".group-member .name").click(this.#onClickMemberName.bind(this));

    // Action buttons
    html.find(".action-button").click(this.#onClickActionButton.bind(this));
    html.find(".item-control").click(this.#onClickItemControl.bind(this));

    // Item summaries
    html.find(".item .rollable h4").click(event => this.#onClickItemName(event));
  }

  /* -------------------------------------------- */

  /**
   * Handle clicks to action buttons on the group sheet.
   * @param {PointerEvent} event      The initiating click event
   */
  #onClickActionButton(event) {
    event.preventDefault();
    const button = event.currentTarget;
    switch ( button.dataset.action ) {
      case "convertCurrency":
        Dialog.confirm({
          title: `${game.i18n.localize("DND5E.CurrencyConvert")}`,
          content: `<p>${game.i18n.localize("DND5E.CurrencyConvertHint")}</p>`,
          yes: () => this.actor.convertCurrency()
        });
        break;
      case "removeMember":
        const removeMemberId = button.closest("li.group-member").dataset.actorId;
        this.object.system.removeMember(removeMemberId);
        break;
      case "movementConfig":
        const movementConfig = new ActorMovementConfig(this.object);
        movementConfig.render(true);
        break;
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle clicks to item control buttons on the group sheet.
   * @param {PointerEvent} event      The initiating click event
   */
  #onClickItemControl(event) {
    event.preventDefault();
    const button = event.currentTarget;
    switch ( button.dataset.action ) {
      case "itemCreate":
        this.#createItem(button);
        break;
      case "itemDelete":
        const deleteLi = event.currentTarget.closest(".item");
        const deleteItem = this.actor.items.get(deleteLi.dataset.itemId);
        deleteItem.deleteDialog();
        break;
      case "itemEdit":
        const editLi = event.currentTarget.closest(".item");
        const editItem = this.actor.items.get(editLi.dataset.itemId);
        editItem.sheet.render(true);
        break;
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle workflows to create a new Item directly within the Group Actor sheet.
   * @param {HTMLElement} button      The clicked create button
   * @returns {Item5e}                The created embedded Item
   */
  #createItem(button) {
    const type = button.dataset.type;
    const system = {...button.dataset};
    delete system.type;
    const name = game.i18n.format("DND5E.ItemNew", {type: game.i18n.localize(`DND5E.ItemType${type.capitalize()}`)});
    const itemData = {name, type, system};
    return this.actor.createEmbeddedDocuments("Item", [itemData]);
  }

  /* -------------------------------------------- */

  /**
   * Handle clicks on member names in the members list.
   * @param {PointerEvent} event      The initiating click event
   */
  #onClickMemberName(event) {
    event.preventDefault();
    const member = event.currentTarget.closest("li.group-member");
    const actor = game.actors.get(member.dataset.actorId);
    if ( actor ) actor.sheet.render(true, {focus: true});
  }

  /* -------------------------------------------- */

  /**
   * Handle clicks on an item name to expand its description
   * @param {PointerEvent} event      The initiating click event
   */
  #onClickItemName(event) {
    return game.system.applications.actor.ActorSheet5e.prototype._onItemSummary.call(this, event);
  }

  /* -------------------------------------------- */

  /** @override */
  async _onDropActor(event, data) {
    if ( !this.isEditable ) return;
    const cls = getDocumentClass("Actor");
    const sourceActor = await cls.fromDropData(data);
    if ( !sourceActor ) return;
    return this.object.system.addMember(sourceActor);
  }
}
