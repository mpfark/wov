# Configured stance / source SQL parity

Read-only fresh configuration; SQL source: `20261001130000_combat2_character_persistent_stances.sql`. Installed function bodies were not readable through the available public REST configuration access. This is source/configured parity, not installed-SQL execution proof.

| Class / ability / assignment | SQL cost | Published cost | SQL reserve | Published reserve | Requirements / exclusivity | Match |
|---|---:|---:|---:|---:|---|---|
| assassin / envenom / envenom | 50 | 50 | 0.2 | 0.2 | exclusive with ignite | yes |
| ranger / eagle_eye / eagle_eye | 15 | 15 | 0.1 | 0.1 | none specific; normal ownership/HP/action/resource gates | yes |
| templar / holy_shield / holy_shield | 15 | 15 | 0.1 | 0.1 | none specific; normal ownership/HP/action/resource gates | yes |
| templar / shield_wall / shield_wall | 25 | 25 | 0.15 | 0.15 | equipped durable off-hand shield | yes |
| warrior / battle_cry / battle_cry | 25 | 25 | 0.15 | 0.15 | none specific; normal ownership/HP/action/resource gates | yes |
| wizard / arcane_surge / arcane_surge | 25 | 25 | 0.15 | 0.15 | none specific; normal ownership/HP/action/resource gates | yes |
| wizard / force_shield / force_shield | 15 | 15 | 0.1 | 0.1 | none specific; normal ownership/HP/action/resource gates | yes |
| wizard / ignite / orbs_of_fire | 50 | 50 | 0.2 | 0.2 | exclusive with envenom | yes |

SQL accepts ability and assignment identities. Publication retains both. Shield Wall config requires_shield is true; Ignite and Envenom declare mutual exclusion. Requirements are not invented from prose. SQL activation owns durable equipment/HP/ownership checks; the worker owns captured tick eligibility. No fixed reservation or resource formula changed.
