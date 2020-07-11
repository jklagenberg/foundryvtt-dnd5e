import ActorSheet5e from "./base.js";

/**
 * An Actor sheet for Vehicle type actors.
 * Extends the base ActorSheet5e class.
 * @type {ActorSheet5e}
 */
export default class ActorSheet5eVehicle extends ActorSheet5e {
  /**
   * Define default rendering options for the Vehicle sheet.
   * @returns {Object}
   */
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["dnd5e", "sheet", "actor", "vehicle"],
      width: 605,
      height: 680
    });
  }

  /* -------------------------------------------- */

  /**
   * Compute the total weight of the vehicle's cargo.
   * @returns {{max: number, value: number, pct: number}}
   * @private
   */
  _computeEncumbrance(totalWeight, data) {
    const totalCoins = Object.values(data.data.currency).reduce((acc, denom) => acc + denom, 0);
    totalWeight += totalCoins / CONFIG.DND5E.encumbrance.currencyPerWeight;

    // Vehicle weights are an order of magnitude greater.
    totalWeight /= CONFIG.DND5E.encumbrance.vehicleWeightMultiplier;

    const enc = {
      max: data.data.attributes.capacity.cargo,
      value: Math.round(totalWeight * 10) / 10
    };

    enc.pct = Math.min(enc.value * 100 / enc.max, 99);
    return enc;
  }

  _onCargoRowChange(event) {
    event.preventDefault();
    const target = event.currentTarget;
    const row = target.closest('.item');
    const idx = Number(row.dataset.itemId);
    const property = row.classList.contains('crew') ? 'crew' : 'passengers';
    const cargo = duplicate(this.actor.data.data.cargo[property]);
    const entry = cargo[idx];

    if (!entry) return;

    const key = target.dataset.property || 'name';
    const type = target.dataset.dtype;
    let value = target.value;

    if (type === 'Number') {
      value = Number(value);
    }

    entry[key] = value;
    return this.actor.update({[`data.cargo.${property}`]: cargo});
  }

  _onEditInSheet(event) {
    event.preventDefault();
    const itemID = event.currentTarget.closest('.item').dataset.itemId;
    const item = this.actor.items.get(itemID);
    const property = event.currentTarget.dataset.property;
    const type = event.currentTarget.dataset.dtype;
    let value = event.currentTarget.value;

    switch (type) {
      case 'Number': value = parseInt(value); break;
      case 'Boolean': value = value === 'true'; break;
    }

    return item.update({[`${property}`]: value});
  }

  _onItemCreate(event) {
    event.preventDefault();
    const target = event.currentTarget;
    const type = target.dataset.type;

    if (type === 'crew' || type === 'passengers') {
      const cargo = duplicate(this.actor.data.data.cargo[type]);
      cargo.push(this.actor.constructor.newCargo());
      return this.actor.update({[`data.cargo.${type}`]: cargo});
    }

    return super._onItemCreate(event);
  }

  _onHPChange(event) {
    event.preventDefault();
    const itemID = event.currentTarget.closest('.item').dataset.itemId;
    const item = this.actor.items.get(itemID);
    const hp = Math.clamped(0, parseInt(event.currentTarget.value), item.data.data.hp.max);
    event.currentTarget.value = hp;
    return item.update({'data.hp.value': hp});
  }

  _onToggleItem(event) {
    event.preventDefault();
    const itemID = event.currentTarget.closest('.item').dataset.itemId;
    const item = this.actor.items.get(itemID);
    const crewed = !!item.data.data.crewed;
    return item.update({'data.crewed': !crewed});
  }

  _prepareCrewedItem(item) {
    const isCrewed = item.data.crewed;
    item.toggleClass = isCrewed ? 'active' : '';
    item.toggleTitle = game.i18n.localize(`DND5E.${isCrewed ? 'Crewed' : 'Uncrewed'}`);

    if (item.type === 'feat' && item.data.activation.type === 'crew') {
      item.crew = item.data.activation.cost;
      item.cover = game.i18n.localize(`DND5E.${item.data.cover ? 'CoverTotal' : 'None'}`);
      if (item.data.cover === .5) item.cover = '½';
      else if (item.data.cover === .75) item.cover = '¾';
      else if (item.data.cover === null) item.cover = '—';
      if (item.crew < 1 || item.crew === null) item.crew = '—';
    }

    if (item.type === 'equipment' || item.type === 'weapon') {
      item.threshold = item.data.hp.dt ? item.data.hp.dt : '—';
    }
  }

  /**
   * Organize Owned Items for rendering the Vehicle sheet.
   * @private
   */
  _prepareItems(data) {
    const cargoColumns = [{
      label: game.i18n.localize('DND5E.Quantity'),
      css: 'item-qty',
      property: 'quantity',
      editable: 'Number'
    }];

    const equipmentColumns = [{
      label: game.i18n.localize('DND5E.Quantity'),
      css: 'item-qty',
      property: 'data.quantity'
    }, {
      label: game.i18n.localize('DND5E.AC'),
      css: 'item-ac',
      property: 'data.armor.value'
    }, {
      label: game.i18n.localize('DND5E.HP'),
      css: 'item-hp',
      property: 'data.hp.value',
      editable: 'Number'
    }, {
      label: game.i18n.localize('DND5E.Threshold'),
      css: 'item-threshold',
      property: 'threshold'
    }];

    const features = {
      actions: {
        label: game.i18n.localize('DND5E.ActionPl'),
        items: [],
        crewable: true,
        dataset: {type: 'feat', 'activation.type': 'crew'},
        columns: [{
          label: game.i18n.localize('DND5E.Crew'),
          css: 'item-crew',
          property: 'crew'
        }, {
          label: game.i18n.localize('DND5E.Cover'),
          css: 'item-cover',
          property: 'cover'
        }]
      },
      equipment: {
        label: game.i18n.localize('DND5E.ItemTypeEquipment'),
        items: [],
        crewable: true,
        dataset: {type: 'equipment', 'armor.type': 'vehicle'},
        columns: equipmentColumns
      },
      passive: {
        label: game.i18n.localize('DND5E.Features'),
        items: [],
        dataset: {type: 'feat'}
      },
      reactions: {
        label: game.i18n.localize('DND5E.ReactionPl'),
        items: [],
        dataset: {type: 'feat', 'activation.type': 'reaction'}
      },
      weapons: {
        label: game.i18n.localize('DND5E.ItemTypeWeaponPl'),
        items: [],
        crewable: true,
        dataset: {type: 'weapon', 'weapon-type': 'siege'},
        columns: equipmentColumns
      }
    };

    const cargo = {
      crew: {
        label: game.i18n.localize('DND5E.Crew'),
        items: data.data.cargo.crew,
        css: 'cargo-row crew',
        editableName: true,
        dataset: {type: 'crew'},
        columns: cargoColumns
      },
      passengers: {
        label: game.i18n.localize('DND5E.Passengers'),
        items: data.data.cargo.passengers,
        css: 'cargo-row passengers',
        editableName: true,
        dataset: {type: 'passengers'},
        columns: cargoColumns
      },
      cargo: {
        label: game.i18n.localize('DND5E.VehicleCargo'),
        items: [],
        dataset: {type: 'loot'},
        columns: [{
          label: game.i18n.localize('DND5E.Quantity'),
          css: 'item-qty',
          property: 'data.quantity',
          editable: 'Number'
        }, {
          label: game.i18n.localize('DND5E.Price'),
          css: 'item-price',
          property: 'data.price',
          editable: 'Number'
        }, {
          label: game.i18n.localize('DND5E.Weight'),
          css: 'item-weight',
          property: 'data.weight',
          editable: 'Number'
        }]
      }
    };

    let totalWeight = 0;
    for (const item of data.items) {
      this._prepareCrewedItem(item);
      if (item.type === 'weapon') features.weapons.items.push(item);
      else if (item.type === 'equipment') features.equipment.items.push(item);
      else if (item.type === 'loot') {
        totalWeight += item.data.weight || 0;
        cargo.cargo.items.push(item);
      }
      else if (item.type === 'feat') {
        if (!item.data.activation.type || item.data.activation.type === 'none') {
          features.passive.items.push(item);
        }
        else if (item.data.activation.type === 'reaction') features.reactions.items.push(item);
        else features.actions.items.push(item);
      }
    }

    data.features = Object.values(features);
    data.cargo = Object.values(cargo);
    data.data.attributes.encumbrance = this._computeEncumbrance(totalWeight, data);
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */
  /* -------------------------------------------- */

  /**
   * Activate event listeners using the prepared sheet HTML.
   * @param html {JQuery} The prepared HTML object ready to be rendered into
   *                      the DOM.
   */
  activateListeners(html) {
    super.activateListeners(html);
    if (!this.options.editable) return;

    html.find('.item-toggle').click(this._onToggleItem.bind(this));
    html.find('.item-hp input')
      .click(evt => evt.target.select())
      .change(this._onHPChange.bind(this));

    html.find('.item:not(.cargo-row) input[data-property]')
      .click(evt => evt.target.select())
      .change(this._onEditInSheet.bind(this));

    html.find('.cargo-row input')
      .click(evt => evt.target.select())
      .change(this._onCargoRowChange.bind(this));

    if (this.actor.data.data.attributes.actions.stations) {
      html.find('.counter.actions, .counter.action-thresholds').hide();
    }
  }
};
