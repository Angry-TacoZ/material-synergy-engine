import type { MaterialDefinition, WorldConfig, ReactionRule } from '../engine/config';

type LabMaterial = MaterialDefinition & { color: string; group: string; formula: string; description: string; reactions: readonly string[] };

export const materials = [
  {
    "name": "Empty",
    "density": 0,
    "color": "#151c20",
    "group": "Tool",
    "state": "Empty",
    "formula": "—",
    "description": "Erase particles from the workspace.",
    "reactions": [],
    "key": "empty",
    "thermal": {
      "initialTemperature": 0,
      "capacity": 1,
      "conductivity": 0.12,
      "airTransfer": 0.16,
      "source": false
    }
  },
  {
    "name": "Sand",
    "density": 2650,
    "color": "#f5ce6b",
    "group": "Powders",
    "state": "Powder",
    "formula": "SiO₂",
    "description": "Loose grains fall and form piles. Intense heat fuses sand into glass.",
    "reactions": [
      "Lava + sand → glass"
    ],
    "key": "sand",
    "thermal": {
      "initialTemperature": 0,
      "capacity": 1,
      "conductivity": 0.12,
      "airTransfer": 0.16,
      "source": false
    }
  },
  {
    "name": "Water",
    "density": 1000,
    "color": "#258fff",
    "group": "Liquids",
    "state": "Liquid",
    "formula": "H₂O",
    "description": "Flows into open space, extinguishes fire, and evaporates against lava.",
    "reactions": [
      "Water + lava → stone + steam",
      "Water + fire → steam",
      "Water dissolves salt"
    ],
    "key": "water",
    "thermal": {
      "initialTemperature": 0,
      "capacity": 4,
      "conductivity": 0.12,
      "airTransfer": 0.16,
      "source": false
    }
  },
  {
    "name": "Wood",
    "density": 650,
    "color": "#cf8844",
    "group": "Solids",
    "state": "Solid",
    "formula": "Organic",
    "description": "Connected wood moves as one piece and floats in water. Heavy loads can sink it. Heat and acid break it apart cell by cell.",
    "reactions": [
      "Wood + lava / fire → fire",
      "Acid erodes wood cell by cell"
    ],
    "key": "wood",
    "thermal": {
      "initialTemperature": 0,
      "capacity": 2,
      "conductivity": 0.02,
      "airTransfer": 0.16,
      "source": false,
      "flammability": {
        "output": "fire"
      }
    }
  },
  {
    "name": "Stone",
    "density": 2700,
    "color": "#99acc1",
    "group": "Solids",
    "state": "Solid",
    "formula": "Rock",
    "description": "Connected rock falls as one piece and stops on support. Acid can erode it and break it into fragments.",
    "reactions": [
      "Cooled lava becomes stone",
      "Acid erodes stone cell by cell"
    ],
    "key": "stone",
    "thermal": {
      "initialTemperature": 0,
      "capacity": 2,
      "conductivity": 0.12,
      "airTransfer": 0.16,
      "source": false
    },
    "collision": {
      "hard": true
    }
  },
  {
    "name": "Lava",
    "density": 2800,
    "color": "#ff511c",
    "group": "Liquids",
    "state": "Liquid",
    "formula": "Molten rock",
    "description": "Hot molten rock flows slowly. It ignites fuel and cools when it meets water.",
    "reactions": [
      "Lava + wood → fire",
      "Lava + water → stone + steam",
      "Lava + sand → glass"
    ],
    "key": "lava",
    "thermal": {
      "initialTemperature": 1200,
      "capacity": 1,
      "conductivity": 0.12,
      "airTransfer": 0.16,
      "source": true
    },
    "motion": {
      "stepEvery": 3
    }
  },
  {
    "name": "Fire",
    "density": 0.3,
    "color": "#ffdc38",
    "group": "Energy",
    "state": "Gas",
    "formula": "Combustion",
    "description": "Rises, spreads through fuel, and eventually burns out. Water extinguishes it.",
    "reactions": [
      "Fire + wood / oil → fire",
      "Fire + ice → water"
    ],
    "key": "fire",
    "thermal": {
      "initialTemperature": 700,
      "capacity": 1,
      "conductivity": 0.12,
      "airTransfer": 0.16,
      "source": true
    },
    "lifetime": {
      "min": 160,
      "range": 200,
      "output": "ash",
      "spawnAbove": {
        "chance": 0.08,
        "output": "smoke"
      }
    }
  },
  {
    "name": "Oil",
    "density": 850,
    "color": "#c8b82c",
    "group": "Liquids",
    "state": "Liquid",
    "formula": "Hydrocarbons",
    "description": "Flows and floats on water. Ignites when it touches fire or lava.",
    "reactions": [
      "Oil + fire / lava → fire",
      "Oil floats on water"
    ],
    "key": "oil",
    "thermal": {
      "initialTemperature": 0,
      "capacity": 1,
      "conductivity": 0.12,
      "airTransfer": 0.16,
      "source": false,
      "flammability": {
        "output": "fire"
      }
    }
  },
  {
    "name": "Ice",
    "density": 917,
    "color": "#8feaff",
    "group": "Solids",
    "state": "Solid",
    "formula": "H₂O",
    "description": "Connected ice moves as one piece and floats mostly submerged in water. Heat melts individual cells, freeing disconnected chunks.",
    "reactions": [
      "Ice + fire / lava → water",
      "Acid erodes ice cell by cell"
    ],
    "key": "ice",
    "thermal": {
      "initialTemperature": -10,
      "capacity": 2,
      "conductivity": 0.12,
      "airTransfer": 0.16,
      "source": false,
      "phaseChange": {
        "point": 0,
        "heat": 40,
        "output": "water",
        "counter": "melting"
      }
    }
  },
  {
    "name": "Steam",
    "density": 0.6,
    "color": "#d0edff",
    "group": "Gases",
    "state": "Gas",
    "formula": "H₂O",
    "description": "Rises and gradually condenses back into water.",
    "reactions": [
      "Steam cools → water"
    ],
    "key": "steam",
    "thermal": {
      "initialTemperature": 100,
      "capacity": 1,
      "conductivity": 0.12,
      "airTransfer": 0.16,
      "source": false
    },
    "lifetime": {
      "min": 520,
      "range": 300,
      "output": "water"
    },
    "motion": {
      "pauseChance": 0.25,
      "diagonalFirstChance": 0.6
    }
  },
  {
    "name": "Smoke",
    "density": 1,
    "color": "#929cb4",
    "group": "Gases",
    "state": "Gas",
    "formula": "Mixture",
    "description": "A rising byproduct of combustion that gradually disperses.",
    "reactions": [
      "Smoke disperses over time"
    ],
    "key": "smoke",
    "thermal": {
      "initialTemperature": 0,
      "capacity": 1,
      "conductivity": 0.12,
      "airTransfer": 0.16,
      "source": false
    },
    "lifetime": {
      "min": 200,
      "range": 240,
      "output": "empty"
    }
  },
  {
    "name": "Salt",
    "density": 2160,
    "color": "#e3e6d9",
    "group": "Powders",
    "state": "Powder",
    "formula": "NaCl",
    "description": "Falls as grains and dissolves in water to form saltwater.",
    "reactions": [
      "Salt + water → saltwater"
    ],
    "key": "salt",
    "thermal": {
      "initialTemperature": 0,
      "capacity": 1,
      "conductivity": 0.12,
      "airTransfer": 0.16,
      "source": false
    }
  },
  {
    "name": "Saltwater",
    "density": 1030,
    "color": "#2fd2c1",
    "group": "Liquids",
    "state": "Liquid",
    "formula": "NaCl + H₂O",
    "description": "Flows like water. Heating it with lava releases steam and leaves salt.",
    "reactions": [
      "Saltwater + lava → salt + steam"
    ],
    "key": "saltwater",
    "thermal": {
      "initialTemperature": 0,
      "capacity": 4,
      "conductivity": 0.12,
      "airTransfer": 0.16,
      "source": false
    }
  },
  {
    "name": "Glass",
    "density": 2500,
    "color": "#57cbb5",
    "group": "Solids",
    "state": "Solid",
    "formula": "SiO₂",
    "description": "Connected glass moves as one piece and sinks in water. Fast impacts against stone, concrete, or glass shatter it into loose shards. Gentle landings leave it intact.",
    "reactions": [
      "Sand + lava → glass",
      "Glass + hard impact → shards"
    ],
    "key": "glass",
    "thermal": {
      "initialTemperature": 0,
      "capacity": 2,
      "conductivity": 0.12,
      "airTransfer": 0.16,
      "source": false
    },
    "collision": {
      "hard": true
    },
    "failure": {
      "impact": {
        "minRelativeSpeed": 1.1,
        "output": "shards",
        "counter": "shattering"
      }
    }
  },
  {
    "name": "Ash",
    "density": 400,
    "color": "#aaa5a1",
    "group": "Powders",
    "state": "Powder",
    "formula": "Residue",
    "description": "Fine falling particles left behind by burning fuel.",
    "reactions": [
      "Burning fuel leaves ash"
    ],
    "key": "ash",
    "thermal": {
      "initialTemperature": 0,
      "capacity": 1,
      "conductivity": 0.12,
      "airTransfer": 0.16,
      "source": false
    }
  },
  {
    "name": "Acid",
    "density": 1200,
    "color": "#a5ff3e",
    "group": "Liquids",
    "state": "Liquid",
    "formula": "Corrosive mixture",
    "description": "Flows downward and consumes exposed wood, stone, and ice cells. Each acid particle is spent after one reaction.",
    "reactions": [
      "Acid + wood / stone → erosion",
      "Acid + ice → water",
      "Glass resists this acid"
    ],
    "key": "acid",
    "thermal": {
      "initialTemperature": 0,
      "capacity": 1,
      "conductivity": 0.12,
      "airTransfer": 0.16,
      "source": false
    }
  },
  {
    "name": "Concrete",
    "density": 2400,
    "color": "#bdc0b8",
    "group": "Solids",
    "state": "Solid",
    "formula": "Composite",
    "description": "Dense concrete bonds into solid pieces and sinks in water. Concentrated weight and bending can fracture weak sections into rubble. It does not burn; acid erodes exposed cells.",
    "reactions": [
      "Overloaded concrete → rubble",
      "Acid erodes concrete cell by cell"
    ],
    "key": "concrete",
    "thermal": {
      "initialTemperature": 0,
      "capacity": 2,
      "conductivity": 0.12,
      "airTransfer": 0.16,
      "source": false
    },
    "collision": {
      "hard": true
    },
    "failure": {
      "stress": {
        "compression": 30,
        "bending": 24,
        "interval": 12,
        "minCells": 3,
        "sectionRadius": 8,
        "limit": 64,
        "fraction": 0.02,
        "output": "rubble",
        "counter": "fracture"
      }
    }
  },
  {
    "name": "Grass",
    "density": 450,
    "color": "#72d447",
    "group": "Solids",
    "state": "Solid",
    "formula": "Plant",
    "description": "Light grass bonds where its cells touch and floats in water. Fire and lava burn it; acid consumes exposed cells. It does not grow automatically.",
    "reactions": [
      "Grass + fire / lava → fire",
      "Acid erodes grass cell by cell"
    ],
    "key": "grass",
    "thermal": {
      "initialTemperature": 0,
      "capacity": 2,
      "conductivity": 0.12,
      "airTransfer": 0.16,
      "source": false,
      "flammability": {
        "output": "fire"
      }
    }
  },
  {
    "name": "Rubble",
    "density": 2400,
    "color": "#aeb1a9",
    "group": "Powders",
    "state": "Powder",
    "formula": "Debris",
    "description": "Loose concrete debris produced when overloaded connections fracture. Falls as grains and retains the concrete mass.",
    "reactions": [
      "Overloaded concrete → rubble"
    ],
    "key": "rubble",
    "thermal": {
      "initialTemperature": 0,
      "capacity": 1,
      "conductivity": 0.12,
      "airTransfer": 0.16,
      "source": false
    },
    "displaceWhenTrapped": true
  },
  {
    "name": "Glass shards",
    "density": 2500,
    "color": "#80ded0",
    "group": "Powders",
    "state": "Powder",
    "formula": "SiO₂",
    "description": "Loose glass fragments from hard impacts. Fall as grains, sink in water, and preserve the shattered glass mass.",
    "reactions": [
      "Glass + hard impact → shards"
    ],
    "key": "shards",
    "thermal": {
      "initialTemperature": 0,
      "capacity": 1,
      "conductivity": 0.12,
      "airTransfer": 0.16,
      "source": false
    }
  }
] satisfies readonly LabMaterial[];

export const M = { Empty: 0, Sand: 1, Water: 2, Wood: 3, Stone: 4, Lava: 5, Fire: 6, Oil: 7, Ice: 8, Steam: 9, Smoke: 10, Salt: 11, Saltwater: 12, Glass: 13, Ash: 14, Acid: 15, Concrete: 16, Grass: 17, Rubble: 18, Shards: 19 };


const contactRules: ReactionRule[] = [
  { inputs: { self: ['acid'], neighbor: ['wood','stone','concrete','grass'] }, outputs: [{ target: 'neighbor', material: 'empty' }, { target: 'self', material: 'empty' }], counter: 'erosion', stop: true },
  { inputs: { self: ['acid'], neighbor: ['ice'] }, outputs: [{ target: 'neighbor', material: 'water' }, { target: 'self', material: 'empty' }], counter: 'erosion', stop: true },
  { inputs: { self: ['lava','fire'], neighbor: { flammable: true } }, outputs: [{ target: 'neighbor', material: '$flammability' }], counter: 'ignition' },
  { inputs: { self: ['lava','fire'], neighbor: ['ice'] }, outputs: [{ target: 'neighbor', material: 'water' }], counter: 'melting' },
  { inputs: { self: ['lava'], neighbor: ['water'] }, outputs: [{ target: 'self', material: 'stone' }, { target: 'neighbor', material: 'steam' }], counter: 'cooling', stop: true },
  { inputs: { self: ['lava'], neighbor: ['saltwater'] }, outputs: [{ target: 'self', material: 'stone' }, { target: 'neighbor', material: 'steam' }, { target: 'empty-neighbor', material: 'salt' }], counter: 'cooling', stop: true },
  { inputs: { self: ['lava'], neighbor: ['sand'] }, outputs: [{ target: 'neighbor', material: 'glass' }], counter: 'glass' },
  { inputs: { self: ['fire'], neighbor: ['water','saltwater'] }, outputs: [{ target: 'self', material: 'smoke' }, { target: 'neighbor', material: 'steam' }], stop: true },
  { inputs: { self: ['salt'], neighbor: ['water'] }, outputs: [{ target: 'self', material: 'empty' }, { target: 'neighbor', material: 'saltwater' }], counter: 'dissolving', stop: true },
];
export const labConfig: WorldConfig = { materials, reactions: contactRules, counters: ['ignition','cooling','melting','glass','dissolving','erosion','fracture','shattering'] };
