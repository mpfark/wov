# World of Edhelard - Node Data Export

## Coordinate System
- Grid coordinates (x, y) where Hearthvale Square is the origin (0, 0)
- North = y decreases, South = y increases, East = x increases, West = x decreases
- Diagonal directions: NE = (x+1, y-1), NW = (x-1, y-1), SE = (x+1, y+1), SW = (x-1, y+1)
- Connections use compass directions: N, S, E, W, NE, NW, SE, SW

## Regions Overview
| Region | Levels | Nodes | Description |
|--------|--------|-------|-------------|
| The Hearthlands | 1-5 | 62 | Gentle rolling hills and farmland surrounding the central hub of Hearthvale |
| The Glimmering Coast | 6-10 | 31 | Coastal region west of Hearthvale |
| The Weeping Fens | 10-15 | 10 | Swamplands far to the southwest |
| The Sun-Scorched Wastes | 15-20 | 13 | Desert region south of the world |
| The Frostpeaks Foothills | 20-25 | 21 | Mountain region far to the north |
| The Mourn-Woods | 25-30 | 12 | Dark forest region to the east |

## Nodes by Region

### The Frostpeaks Foothills (Lvl 20-25)

#### Kharak-Dum (town area)
| Node | x | y | Connections | Flags |
|------|---|---|-------------|-------|
| The Stone-Sleeper's Hall | 3 | -27 | S→Hall of Merchants | inn |
| The Deep-Way Tunnel | 4 | -27 | SW→Hall of Merchants | |
| The Deep-Core Forge | 2 | -26 | E→Hall of Merchants | blacksmith |
| The Hall of Merchants | 3 | -26 | S, W→Deep-Core Forge, N→Stone-Sleeper's Hall, E→Throne of Stone, NE→Deep-Way Tunnel | vendor |
| The Throne of Stone | 4 | -26 | W→Hall of Merchants | |
| The Great Brass Gates | 3 | -25 | S, N→Hall of Merchants | |

#### Icewatch Village (town area)
| Node | x | y | Connections | Flags |
|------|---|---|-------------|-------|
| The Watchtower | 1 | -21 | SE→Frozen Square | teleport |
| Kharak-Dum Approach | 2 | -21 | S→Frozen Square, N→(path to Kharak-Dum) | |
| The High-Pass Armory | 1 | -20 | E→Frozen Square | blacksmith |
| The Frozen Square | 2 | -20 | S→Southern Bastion, E→Anvil Rest, W→High-Pass Armory, N→Kharak-Dum Approach, NW→Watchtower, SE→Provisioner's Vault | |
| The Anvil Rest | 3 | -20 | W→Frozen Square | inn |
| The Southern Bastion | 2 | -19 | S, N→Frozen Square | |
| The Provisioner's Vault | 3 | -19 | NW→Frozen Square | vendor |

#### Unnamed path nodes (Frostpeaks → Hearthlands)
| Node | x | y | Connections |
|------|---|---|-------------|
| (unnamed) | 2 | -18 | SW, N→Southern Bastion |
| (unnamed) | 1 | -17 | S, NE |
| (unnamed) | 1 | -16 | SE, N |
| (unnamed) | 2 | -15 | S, NW |
| The Frostpeaks Foothills Entrance | 2 | -14 | S→(Hearthlands), N |
| (unnamed) | 3 | -24 | SW, N→Great Brass Gates |
| (unnamed) | 2 | -23 | S, NE |
| (unnamed) | 2 | -22 | S→Kharak-Dum Approach, N |

---

### The Mourn-Woods (Lvl 25-30)

#### Eldritch Rest (town area)
| Node | x | y | Connections | Flags |
|------|---|---|-------------|-------|
| The Star-Gazer's Inn | 19 | -7 | S→Emerald Plaza | inn |
| The Emerald Plaza | 19 | -6 | S→Canopy Lift, N→Star-Gazer's Inn, E→Fletcher's Loft, SW→Warden's Spire | vendor |
| The Fletcher's Loft | 20 | -6 | W→Emerald Plaza | |
| The Warden's Spire | 18 | -5 | NE→Emerald Plaza | teleport |
| The Canopy Lift | 19 | -5 | S, N→Emerald Plaza | |

#### Unnamed path nodes (Mourn-Woods → Hearthlands)
| Node | x | y | Connections |
|------|---|---|-------------|
| (unnamed) | 19 | -4 | S, N→Canopy Lift |
| (unnamed) | 18 | -3 | SW, E |
| (unnamed) | 19 | -3 | W, N |
| (unnamed) | 16 | -2 | SW→(from Hearthlands), E |
| (unnamed) | 17 | -2 | W, NE |
| The Mourn-Woods Entrance | 14 | -1 | W→(Hearthlands), E |
| (unnamed) | 15 | -1 | W→Entrance, NE |

---

### The Glimmering Coast (Lvl 6-10)

#### Havenport (town area)
| Node | x | y | Connections | Flags |
|------|---|---|-------------|-------|
| Black-Salt Forge | -30 | 2 | SE→Admiral's Plaza | blacksmith |
| The Gilded Anchor Inn | -29 | 2 | S→Admiral's Plaza | inn |
| The Great Lighthouse | -30 | 3 | E→Admiral's Plaza | teleport |
| The Admiral's Plaza | -29 | 3 | E→High Market, N→Gilded Anchor Inn, NW→Black-Salt Forge, W→Great Lighthouse, SW→The Docks, S→Mariner's Chapel | vendor |
| The High Market | -28 | 3 | E→Havenport Main Gate, W→Admiral's Plaza | |
| Havenport Main Gate | -27 | 3 | E→(road), W→High Market | |
| The Docks | -30 | 4 | NE→Admiral's Plaza | |
| The Mariner's Chapel | -29 | 4 | N→Admiral's Plaza | |

#### The road between Havenport and Hearthvale (trail area)
| Node | x | y | Connections |
|------|---|---|-------------|
| (unnamed) | -26 | 3 | E, W→Havenport Main Gate, S |
| (unnamed) | -25 | 3 | E, W, S |
| (unnamed) | -24 | 3 | NE, W |
| (unnamed) | -23 | 2 | E, SW |
| (unnamed) | -22 | 2 | SE, W |
| (unnamed) | -21 | 3 | E, W→(unnamed at -22,2 NW) |
| (unnamed) | -20 | 3 | E, N→Broken Wheel Inn, W |
| The Broken Wheel Inn | -20 | 2 | S→(road) | inn |
| (unnamed) | -19 | 3 | E, W |
| (unnamed) | -18 | 3 | SE, W |
| (unnamed) | -17 | 4 | E, NW |
| (unnamed) | -16 | 4 | NE, W |
| (unnamed) | -15 | 3 | E→Glimmering Coast Entrance, SW |
| The Glimmering Coast Entrance | -14 | 3 | NE→(Hearthlands), W |

#### Southern coastal path
| Node | x | y | Connections |
|------|---|---|-------------|
| (unnamed) | -25 | 4 | N→(road), S |
| (unnamed) | -25 | 5 | N, SE |
| (unnamed) | -24 | 6 | NW, S |
| (unnamed) | -24 | 7 | N, S |
| (unnamed) | -24 | 8 | N, SW |
| (unnamed) | -25 | 9 | NE, SW |
| (unnamed) | -26 | 10 | NE, S |
| (unnamed) | -26 | 11 | N, S |
| (unnamed) | -26 | 12 | N→(above), S |

---

### The Hearthlands (Lvl 1-5)

#### Hearthvale (town area)
| Node | x | y | Connections | Flags |
|------|---|---|-------------|-------|
| The Northern Gate | 0 | -1 | S→Hearthvale Square, N→(north road) | |
| Hearthvale Square | 0 | 0 | N→Northern Gate, S→Southern Gate, E→Eastern Postern, W→Western Arch | vendor, inn, blacksmith, teleport, trainer |
| The Southern Gate | 0 | 1 | N→Hearthvale Square, S→(south road) | |
| The Western Arch | -1 | 0 | E→Hearthvale Square, W→(west road) | |
| The Eastern Postern | 1 | 0 | W→Hearthvale Square, E→(east road) | |

#### Northern road (Hearthlands → Frostpeaks)
| Node | x | y | Connections |
|------|---|---|-------------|
| (unnamed) | 0 | -2 | S→Northern Gate, NE |
| (unnamed) | 1 | -3 | S, SW |
| (unnamed) | 1 | -4 | S, N |
| (unnamed) | 1 | -5 | S, NE |
| (unnamed) | 2 | -6 | S, SW |
| (unnamed) | 2 | -7 | N, S |
| (unnamed) | 2 | -8 | N, S |
| (unnamed) | 2 | -9 | N, S |
| (unnamed) | 2 | -10 | N, NE |
| (unnamed) | 3 | -11 | N, SW |
| (unnamed) | 2 | -12 | NE, S |
| (unnamed) | 2 | -13 | N, S→Frostpeaks Entrance (2,-14) |

#### Eastern road (Hearthlands → Mourn-Woods)
| Node | x | y | Connections |
|------|---|---|-------------|
| (unnamed) | 2 | 0 | W→Eastern Postern, E |
| (unnamed) | 3 | 0 | W, E |
| (unnamed) | 4 | 0 | W, NE |
| (unnamed) | 5 | -1 | SW, E |
| (unnamed) | 6 | -1 | W, NE |
| (unnamed) | 7 | -2 | SW, E |
| (unnamed) | 8 | -2 | W, E |
| (unnamed) | 9 | -2 | W, NE |
| (unnamed) | 10 | -3 | SW, E |
| (unnamed) | 11 | -3 | W, E |
| (unnamed) | 12 | -3 | W, SE |
| (unnamed) | 13 | -2 | NW, E→Mourn-Woods Entrance (14,-1) |

#### Western road (Hearthlands → Glimmering Coast)
| Node | x | y | Connections |
|------|---|---|-------------|
| (unnamed) | -2 | 0 | E→Western Arch, W |
| (unnamed) | -3 | 0 | E, W |
| (unnamed) | -4 | 0 | E, SW |
| (unnamed) | -5 | 1 | NE, W |
| (unnamed) | -6 | 1 | E, SW |
| (unnamed) | -7 | 2 | NE, W |
| (unnamed) | -8 | 2 | E, W |
| (unnamed) | -9 | 2 | E, SW |
| (unnamed) | -10 | 3 | NE, W |
| (unnamed) | -11 | 3 | E, SW |
| (unnamed) | -12 | 4 | NE, SE→Glimmering Coast Entrance |
| The Glimmering Coast Entrance (Hearthlands side) | -13 | 3 | NW→(road), SW→(into Coast) |

#### Southern road (Hearthlands → Sun-Scorched Wastes)
| Node | x | y | Connections |
|------|---|---|-------------|
| (unnamed) | 0 | 2 | N→Southern Gate, SE |
| (unnamed) | 1 | 3 | NW, S |
| (unnamed) | 1 | 4 | N, S |
| (unnamed) | 1 | 5 | N, SW |
| (unnamed) | 0 | 6 | NE, S |
| (unnamed) | 0 | 7 | N, SE |
| (unnamed) | 1 | 8 | NW, S |
| (unnamed) | 1 | 9 | N, SW |
| (unnamed) | 0 | 10 | NE, S |
| (unnamed) | 0 | 11 | N, SW→(to Weeping Fens path) |
| The Great Cataract | -2 | 11 | N→(above), SW→(Weeping Fens path) |

#### Path to Sun-Scorched Wastes
| Node | x | y | Connections |
|------|---|---|-------------|
| (unnamed) | -1 | 12 | NE→Great Cataract, S |
| (unnamed) | -1 | 13 | N, SW→(to Wastes) |
| (unnamed) | -2 | 13 | NE→(above), S→(Wastes entrance) |
| Sun-Scorched Wastes Entrance | -3 | 13 | N, S→(into Wastes) |

---

### The Sun-Scorched Wastes (Lvl 15-20)

| Node | x | y | Connections |
|------|---|---|-------------|
| (unnamed) | -3 | 14 | N→Entrance, SE |
| (unnamed) | -2 | 15 | NW, S |
| (unnamed) | -2 | 16 | N, SE |
| (unnamed) | -1 | 17 | NW, S |
| (unnamed) | -1 | 18 | N, SW |
| (unnamed) | -2 | 19 | NE, S |
| (unnamed) | -2 | 20 | N, S |
| (unnamed) | -2 | 21 | N, SE |
| (unnamed) | -1 | 22 | NW, S |
| (unnamed) | -1 | 23 | N, SE |
| (unnamed) | 0 | 24 | NW, S |
| (unnamed) | 0 | 25 | N, S |
| (unnamed) | 0 | 26 | N (dead end) |

---

### The Weeping Fens (Lvl 10-15)

| Node | x | y | Connections |
|------|---|---|-------------|
| (unnamed) | -3 | 12 | NE→(Hearthlands), SW |
| (unnamed) | -4 | 13 | NE, SW |
| (unnamed) | -5 | 14 | NE, S |
| (unnamed) | -27 | 13 | NE, S |
| (unnamed) | -27 | 14 | N, S |
| (unnamed) | -27 | 15 | N, S |
| (unnamed) | -28 | 16 | NE, S |
| (unnamed) | -28 | 17 | N, S |
| (unnamed) | -28 | 18 | N, SW |
| (unnamed) | -29 | 19 | NE (dead end path) |

---

## Key Map Facts
- **Origin**: Hearthvale Square at (0, 0)
- **Total nodes**: 149
- **Most nodes lack names** — they are unnamed path/wilderness nodes connecting named locations
- **Towns** serve as hubs with multiple services (vendor, inn, blacksmith, teleport, trainer)
- **Each region has one entrance node** connecting it to the Hearthlands road network
- **Directions**: N=(0,-1), S=(0,+1), E=(+1,0), W=(-1,0), NE=(+1,-1), NW=(-1,-1), SE=(+1,+1), SW=(-1,+1)
