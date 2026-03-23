export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          character_id: string | null
          created_at: string
          event_type: string
          id: string
          message: string
          metadata: Json
          user_id: string
        }
        Insert: {
          character_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          message: string
          metadata?: Json
          user_id: string
        }
        Update: {
          character_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          message?: string
          metadata?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      area_types: {
        Row: {
          created_at: string
          emoji: string
          name: string
        }
        Insert: {
          created_at?: string
          emoji?: string
          name: string
        }
        Update: {
          created_at?: string
          emoji?: string
          name?: string
        }
        Relationships: []
      }
      areas: {
        Row: {
          area_type: string
          created_at: string
          creature_types: string
          description: string
          flavor_text: string
          id: string
          max_level: number
          min_level: number
          name: string
          region_id: string
        }
        Insert: {
          area_type?: string
          created_at?: string
          creature_types?: string
          description?: string
          flavor_text?: string
          id?: string
          max_level?: number
          min_level?: number
          name: string
          region_id: string
        }
        Update: {
          area_type?: string
          created_at?: string
          creature_types?: string
          description?: string
          flavor_text?: string
          id?: string
          max_level?: number
          min_level?: number
          name?: string
          region_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "areas_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      character_inventory: {
        Row: {
          belt_slot: number | null
          character_id: string
          created_at: string
          current_durability: number
          equipped_slot: Database["public"]["Enums"]["item_slot"] | null
          id: string
          item_id: string
        }
        Insert: {
          belt_slot?: number | null
          character_id: string
          created_at?: string
          current_durability?: number
          equipped_slot?: Database["public"]["Enums"]["item_slot"] | null
          id?: string
          item_id: string
        }
        Update: {
          belt_slot?: number | null
          character_id?: string
          created_at?: string
          current_durability?: number
          equipped_slot?: Database["public"]["Enums"]["item_slot"] | null
          id?: string
          item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_inventory_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_inventory_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      character_visited_nodes: {
        Row: {
          character_id: string
          first_visited_at: string
          id: string
          node_id: string
        }
        Insert: {
          character_id: string
          first_visited_at?: string
          id?: string
          node_id: string
        }
        Update: {
          character_id?: string
          first_visited_at?: string
          id?: string
          node_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_visited_nodes_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_visited_nodes_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      characters: {
        Row: {
          ac: number
          bhp: number
          bhp_trained: Json
          cha: number
          class: Database["public"]["Enums"]["character_class"]
          con: number
          cp: number
          created_at: string
          current_node_id: string | null
          dex: number
          gender: Database["public"]["Enums"]["character_gender"]
          gold: number
          hp: number
          id: string
          int: number
          last_online: string
          level: number
          max_cp: number
          max_hp: number
          max_mp: number
          mp: number
          name: string
          race: Database["public"]["Enums"]["character_race"]
          respec_points: number
          salvage: number
          soulforged_item_created: boolean
          str: number
          unspent_stat_points: number
          updated_at: string
          user_id: string
          wis: number
          xp: number
        }
        Insert: {
          ac?: number
          bhp?: number
          bhp_trained?: Json
          cha?: number
          class: Database["public"]["Enums"]["character_class"]
          con?: number
          cp?: number
          created_at?: string
          current_node_id?: string | null
          dex?: number
          gender?: Database["public"]["Enums"]["character_gender"]
          gold?: number
          hp?: number
          id?: string
          int?: number
          last_online?: string
          level?: number
          max_cp?: number
          max_hp?: number
          max_mp?: number
          mp?: number
          name: string
          race: Database["public"]["Enums"]["character_race"]
          respec_points?: number
          salvage?: number
          soulforged_item_created?: boolean
          str?: number
          unspent_stat_points?: number
          updated_at?: string
          user_id: string
          wis?: number
          xp?: number
        }
        Update: {
          ac?: number
          bhp?: number
          bhp_trained?: Json
          cha?: number
          class?: Database["public"]["Enums"]["character_class"]
          con?: number
          cp?: number
          created_at?: string
          current_node_id?: string | null
          dex?: number
          gender?: Database["public"]["Enums"]["character_gender"]
          gold?: number
          hp?: number
          id?: string
          int?: number
          last_online?: string
          level?: number
          max_cp?: number
          max_hp?: number
          max_mp?: number
          mp?: number
          name?: string
          race?: Database["public"]["Enums"]["character_race"]
          respec_points?: number
          salvage?: number
          soulforged_item_created?: boolean
          str?: number
          unspent_stat_points?: number
          updated_at?: string
          user_id?: string
          wis?: number
          xp?: number
        }
        Relationships: [
          {
            foreignKeyName: "characters_current_node_id_fkey"
            columns: ["current_node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      class_starting_gear: {
        Row: {
          class: Database["public"]["Enums"]["character_class"]
          created_at: string
          id: string
          item_id: string
        }
        Insert: {
          class: Database["public"]["Enums"]["character_class"]
          created_at?: string
          id?: string
          item_id: string
        }
        Update: {
          class?: Database["public"]["Enums"]["character_class"]
          created_at?: string
          id?: string
          item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_starting_gear_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      creatures: {
        Row: {
          ac: number
          base_aggressive: boolean
          created_at: string
          description: string
          died_at: string | null
          drop_chance: number
          hp: number
          id: string
          is_aggressive: boolean
          is_alive: boolean
          is_humanoid: boolean
          level: number
          loot_table: Json
          loot_table_id: string | null
          max_hp: number
          name: string
          node_id: string | null
          rarity: Database["public"]["Enums"]["creature_rarity"]
          respawn_seconds: number
          stats: Json
        }
        Insert: {
          ac?: number
          base_aggressive?: boolean
          created_at?: string
          description?: string
          died_at?: string | null
          drop_chance?: number
          hp?: number
          id?: string
          is_aggressive?: boolean
          is_alive?: boolean
          is_humanoid?: boolean
          level?: number
          loot_table?: Json
          loot_table_id?: string | null
          max_hp?: number
          name: string
          node_id?: string | null
          rarity?: Database["public"]["Enums"]["creature_rarity"]
          respawn_seconds?: number
          stats?: Json
        }
        Update: {
          ac?: number
          base_aggressive?: boolean
          created_at?: string
          description?: string
          died_at?: string | null
          drop_chance?: number
          hp?: number
          id?: string
          is_aggressive?: boolean
          is_alive?: boolean
          is_humanoid?: boolean
          level?: number
          loot_table?: Json
          loot_table_id?: string | null
          max_hp?: number
          name?: string
          node_id?: string | null
          rarity?: Database["public"]["Enums"]["creature_rarity"]
          respawn_seconds?: number
          stats?: Json
        }
        Relationships: [
          {
            foreignKeyName: "creatures_loot_table_id_fkey"
            columns: ["loot_table_id"]
            isOneToOne: false
            referencedRelation: "loot_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creatures_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_reports: {
        Row: {
          character_id: string | null
          character_name: string
          created_at: string
          id: string
          message: string
          status: string
          user_id: string
        }
        Insert: {
          character_id?: string | null
          character_name?: string
          created_at?: string
          id?: string
          message: string
          status?: string
          user_id: string
        }
        Update: {
          character_id?: string | null
          character_name?: string
          created_at?: string
          id?: string
          message?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_reports_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          created_at: string
          description: string
          hands: number | null
          id: string
          is_soulbound: boolean
          item_type: string
          level: number
          max_durability: number
          name: string
          origin_id: string | null
          origin_type: string | null
          rarity: Database["public"]["Enums"]["item_rarity"]
          slot: Database["public"]["Enums"]["item_slot"] | null
          stats: Json
          value: number
        }
        Insert: {
          created_at?: string
          description?: string
          hands?: number | null
          id?: string
          is_soulbound?: boolean
          item_type?: string
          level?: number
          max_durability?: number
          name: string
          origin_id?: string | null
          origin_type?: string | null
          rarity?: Database["public"]["Enums"]["item_rarity"]
          slot?: Database["public"]["Enums"]["item_slot"] | null
          stats?: Json
          value?: number
        }
        Update: {
          created_at?: string
          description?: string
          hands?: number | null
          id?: string
          is_soulbound?: boolean
          item_type?: string
          level?: number
          max_durability?: number
          name?: string
          origin_id?: string | null
          origin_type?: string | null
          rarity?: Database["public"]["Enums"]["item_rarity"]
          slot?: Database["public"]["Enums"]["item_slot"] | null
          stats?: Json
          value?: number
        }
        Relationships: []
      }
      loot_table_entries: {
        Row: {
          created_at: string
          id: string
          item_id: string
          loot_table_id: string
          weight: number
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          loot_table_id: string
          weight?: number
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          loot_table_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "loot_table_entries_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loot_table_entries_loot_table_id_fkey"
            columns: ["loot_table_id"]
            isOneToOne: false
            referencedRelation: "loot_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      loot_tables: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      node_ground_loot: {
        Row: {
          creature_name: string | null
          dropped_at: string
          dropped_by: string | null
          id: string
          item_id: string
          node_id: string
        }
        Insert: {
          creature_name?: string | null
          dropped_at?: string
          dropped_by?: string | null
          id?: string
          item_id: string
          node_id: string
        }
        Update: {
          creature_name?: string | null
          dropped_at?: string
          dropped_by?: string | null
          id?: string
          item_id?: string
          node_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "node_ground_loot_dropped_by_fkey"
            columns: ["dropped_by"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_ground_loot_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_ground_loot_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      nodes: {
        Row: {
          area_id: string | null
          connections: Json
          created_at: string
          description: string
          id: string
          is_blacksmith: boolean
          is_inn: boolean
          is_teleport: boolean
          is_trainer: boolean
          is_vendor: boolean
          name: string
          region_id: string
          searchable_items: Json
          x: number
          y: number
        }
        Insert: {
          area_id?: string | null
          connections?: Json
          created_at?: string
          description?: string
          id?: string
          is_blacksmith?: boolean
          is_inn?: boolean
          is_teleport?: boolean
          is_trainer?: boolean
          is_vendor?: boolean
          name?: string
          region_id: string
          searchable_items?: Json
          x?: number
          y?: number
        }
        Update: {
          area_id?: string | null
          connections?: Json
          created_at?: string
          description?: string
          id?: string
          is_blacksmith?: boolean
          is_inn?: boolean
          is_teleport?: boolean
          is_trainer?: boolean
          is_vendor?: boolean
          name?: string
          region_id?: string
          searchable_items?: Json
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "nodes_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      npcs: {
        Row: {
          created_at: string
          description: string
          dialogue: string
          id: string
          name: string
          node_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string
          dialogue?: string
          id?: string
          name: string
          node_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string
          dialogue?: string
          id?: string
          name?: string
          node_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "npcs_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      parties: {
        Row: {
          created_at: string
          id: string
          leader_id: string
          tank_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          leader_id: string
          tank_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          leader_id?: string
          tank_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parties_leader_id_fkey"
            columns: ["leader_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parties_tank_id_fkey"
            columns: ["tank_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      party_combat_log: {
        Row: {
          character_name: string | null
          created_at: string
          id: string
          message: string
          node_id: string | null
          party_id: string
        }
        Insert: {
          character_name?: string | null
          created_at?: string
          id?: string
          message: string
          node_id?: string | null
          party_id: string
        }
        Update: {
          character_name?: string | null
          created_at?: string
          id?: string
          message?: string
          node_id?: string | null
          party_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "party_combat_log_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "party_combat_log_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      party_members: {
        Row: {
          character_id: string
          id: string
          is_following: boolean
          joined_at: string
          party_id: string
          status: string
        }
        Insert: {
          character_id: string
          id?: string
          is_following?: boolean
          joined_at?: string
          party_id: string
          status?: string
        }
        Update: {
          character_id?: string
          id?: string
          is_following?: boolean
          joined_at?: string
          party_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "party_members_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "party_members_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      regions: {
        Row: {
          created_at: string
          description: string
          direction: string | null
          id: string
          max_level: number
          min_level: number
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          description?: string
          direction?: string | null
          id?: string
          max_level?: number
          min_level?: number
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          description?: string
          direction?: string | null
          id?: string
          max_level?: number
          min_level?: number
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      roadmap_items: {
        Row: {
          category: string
          created_at: string
          description: string
          id: string
          is_done: boolean
          sort_order: number
          title: string
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string
          id?: string
          is_done?: boolean
          sort_order?: number
          title: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          id?: string
          is_done?: boolean
          sort_order?: number
          title?: string
        }
        Relationships: []
      }
      universal_starting_gear: {
        Row: {
          created_at: string
          equipped_slot: string
          id: string
          item_id: string
        }
        Insert: {
          created_at?: string
          equipped_slot: string
          id?: string
          item_id: string
        }
        Update: {
          created_at?: string
          equipped_slot?: string
          id?: string
          item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "universal_starting_gear_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vendor_inventory: {
        Row: {
          created_at: string
          id: string
          item_id: string
          node_id: string
          price: number
          stock: number
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          node_id: string
          price?: number
          stock?: number
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          node_id?: string
          price?: number
          stock?: number
        }
        Relationships: [
          {
            foreignKeyName: "vendor_inventory_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_inventory_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      xp_boost: {
        Row: {
          activated_by: string | null
          created_at: string
          expires_at: string | null
          id: string
          multiplier: number
        }
        Insert: {
          activated_by?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          multiplier?: number
        }
        Update: {
          activated_by?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          multiplier?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_teleport: {
        Args: { _character_id: string; _node_id: string }
        Returns: undefined
      }
      award_party_member:
        | {
            Args: { _character_id: string; _gold: number; _xp: number }
            Returns: undefined
          }
        | {
            Args: {
              _character_id: string
              _gold: number
              _salvage?: number
              _xp: number
            }
            Returns: undefined
          }
      buy_vendor_item:
        | {
            Args: { p_character_id: string; p_vendor_item_id: string }
            Returns: boolean
          }
        | {
            Args: {
              p_character_id: string
              p_price: number
              p_vendor_item_id: string
            }
            Returns: boolean
          }
      cleanup_ground_loot: { Args: never; Returns: undefined }
      damage_creature: {
        Args: { _creature_id: string; _killed?: boolean; _new_hp: number }
        Returns: undefined
      }
      damage_party_member: {
        Args: { _character_id: string; _damage: number }
        Returns: number
      }
      degrade_party_member_equipment: {
        Args: { _character_id: string }
        Returns: undefined
      }
      drop_item_to_ground: {
        Args: { p_character_id: string; p_inventory_id: string }
        Returns: boolean
      }
      find_character_id_by_name: { Args: { _name: string }; Returns: string }
      get_character_name: { Args: { _character_id: string }; Returns: string }
      grant_starting_gear: {
        Args: { p_character_id: string }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      heal_party_member:
        | {
            Args: {
              _heal_amount: number
              _healer_id: string
              _target_id: string
            }
            Returns: number
          }
        | {
            Args: {
              _effective_max_hp?: number
              _heal_amount: number
              _healer_id: string
              _target_id: string
            }
            Returns: number
          }
      inspect_character_equipment: {
        Args: { _character_id: string }
        Returns: {
          description: string
          durability_pct: number
          hands: number
          item_level: number
          item_name: string
          item_type: string
          rarity: string
          slot: string
          stats: Json
        }[]
      }
      is_overlord: { Args: never; Returns: boolean }
      is_party_mate: { Args: { _character_id: string }; Returns: boolean }
      is_party_member: { Args: { _party_id: string }; Returns: boolean }
      is_steward_or_overlord: { Args: never; Returns: boolean }
      owns_character: { Args: { _character_id: string }; Returns: boolean }
      pickup_ground_loot: {
        Args: { p_character_id: string; p_loot_id: string }
        Returns: boolean
      }
      regen_creature_hp: { Args: never; Returns: undefined }
      respawn_creatures: { Args: never; Returns: undefined }
      return_unique_items: { Args: never; Returns: undefined }
      sell_item: {
        Args: { p_character_id: string; p_inventory_id: string }
        Returns: number
      }
      try_acquire_unique_item: {
        Args: { p_character_id: string; p_item_id: string }
        Returns: boolean
      }
      update_party_member_hp: {
        Args: { _character_id: string; _new_hp: number }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "player" | "steward" | "overlord"
      area_type:
        | "forest"
        | "town"
        | "cave"
        | "ruins"
        | "plains"
        | "mountain"
        | "swamp"
        | "desert"
        | "coast"
        | "dungeon"
        | "other"
      character_class:
        | "warrior"
        | "wizard"
        | "ranger"
        | "rogue"
        | "healer"
        | "bard"
      character_gender: "male" | "female"
      character_race:
        | "human"
        | "elf"
        | "dwarf"
        | "halfling"
        | "edain"
        | "half_elf"
      creature_rarity: "regular" | "rare" | "boss"
      item_rarity: "common" | "uncommon" | "unique"
      item_slot:
        | "head"
        | "amulet"
        | "shoulders"
        | "chest"
        | "gloves"
        | "belt"
        | "pants"
        | "ring"
        | "trinket"
        | "main_hand"
        | "off_hand"
        | "boots"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["player", "steward", "overlord"],
      area_type: [
        "forest",
        "town",
        "cave",
        "ruins",
        "plains",
        "mountain",
        "swamp",
        "desert",
        "coast",
        "dungeon",
        "other",
      ],
      character_class: [
        "warrior",
        "wizard",
        "ranger",
        "rogue",
        "healer",
        "bard",
      ],
      character_gender: ["male", "female"],
      character_race: [
        "human",
        "elf",
        "dwarf",
        "halfling",
        "edain",
        "half_elf",
      ],
      creature_rarity: ["regular", "rare", "boss"],
      item_rarity: ["common", "uncommon", "unique"],
      item_slot: [
        "head",
        "amulet",
        "shoulders",
        "chest",
        "gloves",
        "belt",
        "pants",
        "ring",
        "trinket",
        "main_hand",
        "off_hand",
        "boots",
      ],
    },
  },
} as const
