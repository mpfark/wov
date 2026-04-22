---
name: XP Penalty Logic
description: Scaling penalty for over-leveling, 10% floor
type: feature
---
Experience rewards for characters exceeding a creature's level are subject to a scaling penalty to prevent over-leveling in low-tier areas. The formula is Math.max(1 - levelDiff * rate, 0.10), where the penalty rate increases by level tier (6% for Lv 1-5, 9% for Lv 6-10, and 12% for Lv 11+). This ensures a minimum 10% XP floor regardless of the level gap. To ensure transparency, combat logs explicitly display the final adjusted XP and include a penalty note (e.g., '(40% XP — level penalty)') when applicable.