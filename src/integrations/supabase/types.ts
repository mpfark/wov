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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      abilities: {
        Row: {
          ability_key: string
          ability_type: string
          accuracy_stat: string | null
          activation_mode: string
          admin_notes: string | null
          amount_calc: Json | null
          applied_status: string | null
          base_ability_id: string
          calc_version: number
          class_scale: number
          combat_text: Json
          cp_cost: number
          cp_reserve_pct: number | null
          created_at: string
          damage_type: string | null
          description: string
          duration_calc: Json | null
          effect_config: Json
          id: string
          interval_ms: number | null
          label: string
          mechanic_calcs: Json
          mechanic_key: string
          on_hit_effect: Json | null
          primary_attribute: string | null
          secondary_attribute: string | null
          status: string
          status_application_enabled: boolean
          status_chance_pct: number | null
          status_trigger: string | null
          target_type: string
          tooltip: string
          updated_at: string
        }
        Insert: {
          ability_key: string
          ability_type?: string
          accuracy_stat?: string | null
          activation_mode?: string
          admin_notes?: string | null
          amount_calc?: Json | null
          applied_status?: string | null
          base_ability_id: string
          calc_version?: number
          class_scale?: number
          combat_text?: Json
          cp_cost?: number
          cp_reserve_pct?: number | null
          created_at?: string
          damage_type?: string | null
          description?: string
          duration_calc?: Json | null
          effect_config?: Json
          id?: string
          interval_ms?: number | null
          label: string
          mechanic_calcs?: Json
          mechanic_key: string
          on_hit_effect?: Json | null
          primary_attribute?: string | null
          secondary_attribute?: string | null
          status?: string
          status_application_enabled?: boolean
          status_chance_pct?: number | null
          status_trigger?: string | null
          target_type?: string
          tooltip?: string
          updated_at?: string
        }
        Update: {
          ability_key?: string
          ability_type?: string
          accuracy_stat?: string | null
          activation_mode?: string
          admin_notes?: string | null
          amount_calc?: Json | null
          applied_status?: string | null
          base_ability_id?: string
          calc_version?: number
          class_scale?: number
          combat_text?: Json
          cp_cost?: number
          cp_reserve_pct?: number | null
          created_at?: string
          damage_type?: string | null
          description?: string
          duration_calc?: Json | null
          effect_config?: Json
          id?: string
          interval_ms?: number | null
          label?: string
          mechanic_calcs?: Json
          mechanic_key?: string
          on_hit_effect?: Json | null
          primary_attribute?: string | null
          secondary_attribute?: string | null
          status?: string
          status_application_enabled?: boolean
          status_chance_pct?: number | null
          status_trigger?: string | null
          target_type?: string
          tooltip?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "abilities_base_ability_id_fkey"
            columns: ["base_ability_id"]
            isOneToOne: false
            referencedRelation: "base_abilities"
            referencedColumns: ["id"]
          },
        ]
      }
      active_effects: {
        Row: {
          created_at: string
          damage_per_tick: number
          effect_type: string
          expires_at: number
          id: string
          lifetime: string
          magnitude: number | null
          mechanic: string | null
          next_tick_at: number | null
          node_id: string
          params: Json
          params_version: number
          remaining: number | null
          session_id: string | null
          source_ability_key: string | null
          source_id: string
          stacks: number
          started_at: number | null
          target_id: string
          tick_rate_ms: number
        }
        Insert: {
          created_at?: string
          damage_per_tick: number
          effect_type: string
          expires_at: number
          id?: string
          lifetime?: string
          magnitude?: number | null
          mechanic?: string | null
          next_tick_at?: number | null
          node_id: string
          params?: Json
          params_version?: number
          remaining?: number | null
          session_id?: string | null
          source_ability_key?: string | null
          source_id: string
          stacks?: number
          started_at?: number | null
          target_id: string
          tick_rate_ms?: number
        }
        Update: {
          created_at?: string
          damage_per_tick?: number
          effect_type?: string
          expires_at?: number
          id?: string
          lifetime?: string
          magnitude?: number | null
          mechanic?: string | null
          next_tick_at?: number | null
          node_id?: string
          params?: Json
          params_version?: number
          remaining?: number | null
          session_id?: string | null
          source_ability_key?: string | null
          source_id?: string
          stacks?: number
          started_at?: number | null
          target_id?: string
          tick_rate_ms?: number
        }
        Relationships: []
      }
      ai_credit_drain_item_log: {
        Row: {
          area_id: string | null
          created_at: string
          error: string | null
          id: string
          node_id: string | null
          run_id: string
          status: string
          target_type: string
        }
        Insert: {
          area_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          node_id?: string | null
          run_id: string
          status: string
          target_type?: string
        }
        Update: {
          area_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          node_id?: string | null
          run_id?: string
          status?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_credit_drain_item_log_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ai_credit_drain_log"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_credit_drain_log: {
        Row: {
          cap: number
          generated_count: number
          id: string
          notes: string | null
          run_finished_at: string | null
          run_started_at: string
          stop_reason: string
        }
        Insert: {
          cap?: number
          generated_count?: number
          id?: string
          notes?: string | null
          run_finished_at?: string | null
          run_started_at?: string
          stop_reason?: string
        }
        Update: {
          cap?: number
          generated_count?: number
          id?: string
          notes?: string | null
          run_finished_at?: string | null
          run_started_at?: string
          stop_reason?: string
        }
        Relationships: []
      }
      app_secrets: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      appearance_entries: {
        Row: {
          asset_url: string
          created_at: string
          display_name: string
          id: string
          is_shared: boolean
          layer_order: number | null
          material: string
          occludes: string[]
          prompt_notes: string
          slot: string
          tier: string
          updated_at: string
        }
        Insert: {
          asset_url?: string
          created_at?: string
          display_name?: string
          id?: string
          is_shared?: boolean
          layer_order?: number | null
          material?: string
          occludes?: string[]
          prompt_notes?: string
          slot: string
          tier?: string
          updated_at?: string
        }
        Update: {
          asset_url?: string
          created_at?: string
          display_name?: string
          id?: string
          is_shared?: boolean
          layer_order?: number | null
          material?: string
          occludes?: string[]
          prompt_notes?: string
          slot?: string
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      applied_statuses: {
        Row: {
          admin_notes: string | null
          classification: string
          created_at: string
          default_damage_type: string | null
          duration: Json
          effect_type: string
          is_periodic: boolean | null
          key: string
          label: string
          magnitude: Json
          modifier: Json | null
          stack_noun: string
          stacks: Json
          tick_interval_ms: number | null
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          classification?: string
          created_at?: string
          default_damage_type?: string | null
          duration?: Json
          effect_type: string
          is_periodic?: boolean | null
          key: string
          label: string
          magnitude?: Json
          modifier?: Json | null
          stack_noun?: string
          stacks?: Json
          tick_interval_ms?: number | null
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          classification?: string
          created_at?: string
          default_damage_type?: string | null
          duration?: Json
          effect_type?: string
          is_periodic?: boolean | null
          key?: string
          label?: string
          magnitude?: Json
          modifier?: Json | null
          stack_noun?: string
          stacks?: Json
          tick_interval_ms?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      area_types: {
        Row: {
          color: string
          created_at: string
          name: string
        }
        Insert: {
          color?: string
          created_at?: string
          name: string
        }
        Update: {
          color?: string
          created_at?: string
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
          illustration_metadata: Json | null
          illustration_url: string | null
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
          illustration_metadata?: Json | null
          illustration_url?: string | null
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
          illustration_metadata?: Json | null
          illustration_url?: string | null
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
      base_abilities: {
        Row: {
          activation_mode: string
          admin_notes: string | null
          allowed_target_types: string[]
          amount_calc: Json | null
          base_key: string
          capabilities: Json
          cp_cost: number | null
          cp_reserve_pct: number | null
          created_at: string
          default_target_type: string
          description: string
          duration_calc: Json | null
          effect_config: Json
          id: string
          interval_ms: number | null
          label: string
          mechanic_calcs: Json
          mechanic_key: string
          on_hit_allowed: string[]
          status: string
          supports_secondary_scaling: boolean
          target_type: string | null
          trigger_type: string
          updated_at: string
        }
        Insert: {
          activation_mode?: string
          admin_notes?: string | null
          allowed_target_types?: string[]
          amount_calc?: Json | null
          base_key: string
          capabilities?: Json
          cp_cost?: number | null
          cp_reserve_pct?: number | null
          created_at?: string
          default_target_type?: string
          description?: string
          duration_calc?: Json | null
          effect_config?: Json
          id?: string
          interval_ms?: number | null
          label: string
          mechanic_calcs?: Json
          mechanic_key: string
          on_hit_allowed?: string[]
          status?: string
          supports_secondary_scaling?: boolean
          target_type?: string | null
          trigger_type?: string
          updated_at?: string
        }
        Update: {
          activation_mode?: string
          admin_notes?: string | null
          allowed_target_types?: string[]
          amount_calc?: Json | null
          base_key?: string
          capabilities?: Json
          cp_cost?: number | null
          cp_reserve_pct?: number | null
          created_at?: string
          default_target_type?: string
          description?: string
          duration_calc?: Json | null
          effect_config?: Json
          id?: string
          interval_ms?: number | null
          label?: string
          mechanic_calcs?: Json
          mechanic_key?: string
          on_hit_allowed?: string[]
          status?: string
          supports_secondary_scaling?: boolean
          target_type?: string | null
          trigger_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      character_ability_loadout: {
        Row: {
          ability_id: string
          character_id: string
          created_at: string
          role_id: string
          updated_at: string
        }
        Insert: {
          ability_id: string
          character_id: string
          created_at?: string
          role_id: string
          updated_at?: string
        }
        Update: {
          ability_id?: string
          character_id?: string
          created_at?: string
          role_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_ability_loadout_ability_id_fkey"
            columns: ["ability_id"]
            isOneToOne: false
            referencedRelation: "abilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_ability_loadout_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_ability_loadout_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "class_ability_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      character_class_bonds: {
        Row: {
          bond: number
          character_id: string
          class: string
          updated_at: string
        }
        Insert: {
          bond?: number
          character_id: string
          class: string
          updated_at?: string
        }
        Update: {
          bond?: number
          character_id?: string
          class?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_class_bonds_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_class_bonds_class_fkey"
            columns: ["class"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["class_key"]
          },
        ]
      }
      character_guide_reads: {
        Row: {
          character_id: string
          entry_id: string
          read_at: string
        }
        Insert: {
          character_id: string
          entry_id: string
          read_at?: string
        }
        Update: {
          character_id?: string
          entry_id?: string
          read_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_guide_reads_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_guide_reads_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "guide_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      character_inventory: {
        Row: {
          applied_gems: Json
          character_id: string
          crafted_level: number | null
          created_at: string
          current_durability: number
          equipped_slot: Database["public"]["Enums"]["item_slot"] | null
          id: string
          is_pinned: boolean
          item_id: string
          stat_override: Json | null
        }
        Insert: {
          applied_gems?: Json
          character_id: string
          crafted_level?: number | null
          created_at?: string
          current_durability?: number
          equipped_slot?: Database["public"]["Enums"]["item_slot"] | null
          id?: string
          is_pinned?: boolean
          item_id: string
          stat_override?: Json | null
        }
        Update: {
          applied_gems?: Json
          character_id?: string
          crafted_level?: number | null
          created_at?: string
          current_durability?: number
          equipped_slot?: Database["public"]["Enums"]["item_slot"] | null
          id?: string
          is_pinned?: boolean
          item_id?: string
          stat_override?: Json | null
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
      character_materials: {
        Row: {
          character_id: string
          count: number
          material_key: string
          updated_at: string
        }
        Insert: {
          character_id: string
          count?: number
          material_key: string
          updated_at?: string
        }
        Update: {
          character_id?: string
          count?: number
          material_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_materials_material_key_fkey"
            columns: ["material_key"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["key"]
          },
        ]
      }
      character_npc_gifts: {
        Row: {
          character_id: string
          granted_at: string
          id: string
          item_id: string
          npc_id: string
        }
        Insert: {
          character_id: string
          granted_at?: string
          id?: string
          item_id: string
          npc_id: string
        }
        Update: {
          character_id?: string
          granted_at?: string
          id?: string
          item_id?: string
          npc_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_npc_gifts_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_npc_gifts_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_npc_gifts_npc_id_fkey"
            columns: ["npc_id"]
            isOneToOne: false
            referencedRelation: "npcs"
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
          active_contract: Json | null
          bhp: number
          bhp_trained: Json
          cha: number
          class: string
          combat_trace_enabled: boolean
          con: number
          contracts_completed: number
          cp: number
          created_at: string
          crown_item_created: boolean
          current_node_id: string | null
          dex: number
          family_changed_after_creation: boolean
          family_id: string | null
          family_name: string | null
          gender: Database["public"]["Enums"]["character_gender"]
          gold: number
          hp: number
          id: string
          int: number
          is_classless: boolean
          king_slayer_at: string | null
          last_death_at: string | null
          last_death_log: Json | null
          last_online: string
          level: number
          max_cp: number
          max_hp: number
          max_mp: number
          movement_locked_until: string | null
          mp: number
          name: string
          portrait_generated_at: string | null
          portrait_metadata: Json
          portrait_url: string
          race: string
          reserved_buffs: Json
          respec_points: number
          rp_total_earned: number
          soulforged_item_created: boolean
          soulring_inventory_id: string | null
          soulring_tier: number
          stance_state: Json
          str: number
          unspent_stat_points: number
          updated_at: string
          user_id: string
          wimp_direction: string | null
          wimp_hp_threshold: number
          wis: number
          xp: number
        }
        Insert: {
          ac?: number
          active_contract?: Json | null
          bhp?: number
          bhp_trained?: Json
          cha?: number
          class: string
          combat_trace_enabled?: boolean
          con?: number
          contracts_completed?: number
          cp?: number
          created_at?: string
          crown_item_created?: boolean
          current_node_id?: string | null
          dex?: number
          family_changed_after_creation?: boolean
          family_id?: string | null
          family_name?: string | null
          gender?: Database["public"]["Enums"]["character_gender"]
          gold?: number
          hp?: number
          id?: string
          int?: number
          is_classless?: boolean
          king_slayer_at?: string | null
          last_death_at?: string | null
          last_death_log?: Json | null
          last_online?: string
          level?: number
          max_cp?: number
          max_hp?: number
          max_mp?: number
          movement_locked_until?: string | null
          mp?: number
          name: string
          portrait_generated_at?: string | null
          portrait_metadata?: Json
          portrait_url?: string
          race: string
          reserved_buffs?: Json
          respec_points?: number
          rp_total_earned?: number
          soulforged_item_created?: boolean
          soulring_inventory_id?: string | null
          soulring_tier?: number
          stance_state?: Json
          str?: number
          unspent_stat_points?: number
          updated_at?: string
          user_id: string
          wimp_direction?: string | null
          wimp_hp_threshold?: number
          wis?: number
          xp?: number
        }
        Update: {
          ac?: number
          active_contract?: Json | null
          bhp?: number
          bhp_trained?: Json
          cha?: number
          class?: string
          combat_trace_enabled?: boolean
          con?: number
          contracts_completed?: number
          cp?: number
          created_at?: string
          crown_item_created?: boolean
          current_node_id?: string | null
          dex?: number
          family_changed_after_creation?: boolean
          family_id?: string | null
          family_name?: string | null
          gender?: Database["public"]["Enums"]["character_gender"]
          gold?: number
          hp?: number
          id?: string
          int?: number
          is_classless?: boolean
          king_slayer_at?: string | null
          last_death_at?: string | null
          last_death_log?: Json | null
          last_online?: string
          level?: number
          max_cp?: number
          max_hp?: number
          max_mp?: number
          movement_locked_until?: string | null
          mp?: number
          name?: string
          portrait_generated_at?: string | null
          portrait_metadata?: Json
          portrait_url?: string
          race?: string
          reserved_buffs?: Json
          respec_points?: number
          rp_total_earned?: number
          soulforged_item_created?: boolean
          soulring_inventory_id?: string | null
          soulring_tier?: number
          stance_state?: Json
          str?: number
          unspent_stat_points?: number
          updated_at?: string
          user_id?: string
          wimp_direction?: string | null
          wimp_hp_threshold?: number
          wis?: number
          xp?: number
        }
        Relationships: [
          {
            foreignKeyName: "characters_class_fkey"
            columns: ["class"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["class_key"]
          },
          {
            foreignKeyName: "characters_current_node_id_fkey"
            columns: ["current_node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "characters_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "characters_race_fkey"
            columns: ["race"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["race_key"]
          },
        ]
      }
      class_ability_assignments: {
        Row: {
          ability_id: string
          class_ability_key: string
          class_key: string
          created_at: string
          id: string
          is_default: boolean
          overrides: Json
          role_id: string
          status: string
          unlock_level: number
          updated_at: string
        }
        Insert: {
          ability_id: string
          class_ability_key: string
          class_key: string
          created_at?: string
          id?: string
          is_default?: boolean
          overrides?: Json
          role_id: string
          status?: string
          unlock_level?: number
          updated_at?: string
        }
        Update: {
          ability_id?: string
          class_ability_key?: string
          class_key?: string
          created_at?: string
          id?: string
          is_default?: boolean
          overrides?: Json
          role_id?: string
          status?: string
          unlock_level?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_ability_assignments_ability_id_fkey"
            columns: ["ability_id"]
            isOneToOne: false
            referencedRelation: "abilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_ability_assignments_class_key_fkey"
            columns: ["class_key"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["class_key"]
          },
          {
            foreignKeyName: "class_ability_assignments_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "class_ability_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      class_ability_roles: {
        Row: {
          class_key: string
          created_at: string
          description: string
          id: string
          name: string
          slot: number
          unlock_level: number
          updated_at: string
        }
        Insert: {
          class_key: string
          created_at?: string
          description?: string
          id?: string
          name: string
          slot: number
          unlock_level?: number
          updated_at?: string
        }
        Update: {
          class_key?: string
          created_at?: string
          description?: string
          id?: string
          name?: string
          slot?: number
          unlock_level?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_ability_roles_class_key_fkey"
            columns: ["class_key"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["class_key"]
          },
        ]
      }
      classes: {
        Row: {
          admin_notes: string | null
          base_ac: number
          base_hp: number
          class_key: string
          color: string
          created_at: string
          crit_range: number
          description: string
          is_pre_class: boolean
          is_selectable: boolean
          label: string
          level_bonuses: Json
          primary_attribute: string | null
          restrictions: Json
          secondary_attribute: string | null
          sort_order: number
          status: string
          updated_at: string
          weapon_proficiencies: string[]
        }
        Insert: {
          admin_notes?: string | null
          base_ac?: number
          base_hp?: number
          class_key: string
          color?: string
          created_at?: string
          crit_range?: number
          description?: string
          is_pre_class?: boolean
          is_selectable?: boolean
          label: string
          level_bonuses?: Json
          primary_attribute?: string | null
          restrictions?: Json
          secondary_attribute?: string | null
          sort_order?: number
          status?: string
          updated_at?: string
          weapon_proficiencies?: string[]
        }
        Update: {
          admin_notes?: string | null
          base_ac?: number
          base_hp?: number
          class_key?: string
          color?: string
          created_at?: string
          crit_range?: number
          description?: string
          is_pre_class?: boolean
          is_selectable?: boolean
          label?: string
          level_bonuses?: Json
          primary_attribute?: string | null
          restrictions?: Json
          secondary_attribute?: string | null
          sort_order?: number
          status?: string
          updated_at?: string
          weapon_proficiencies?: string[]
        }
        Relationships: []
      }
      combat_actions: {
        Row: {
          ability_key: string
          character_id: string
          client_seq: number
          consumed_tick: number | null
          created_at: string
          eligible_after_ms: number | null
          encounter_id: string
          id: string
          node_id: string
          reject_reason: string | null
          status: string
          submitted_at: string
          target_character_id: string | null
          target_creature_id: string | null
          updated_at: string
        }
        Insert: {
          ability_key: string
          character_id: string
          client_seq?: number
          consumed_tick?: number | null
          created_at?: string
          eligible_after_ms?: number | null
          encounter_id: string
          id: string
          node_id: string
          reject_reason?: string | null
          status?: string
          submitted_at?: string
          target_character_id?: string | null
          target_creature_id?: string | null
          updated_at?: string
        }
        Update: {
          ability_key?: string
          character_id?: string
          client_seq?: number
          consumed_tick?: number | null
          created_at?: string
          eligible_after_ms?: number | null
          encounter_id?: string
          id?: string
          node_id?: string
          reject_reason?: string | null
          status?: string
          submitted_at?: string
          target_character_id?: string | null
          target_creature_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "combat_actions_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combat_actions_encounter_id_fkey"
            columns: ["encounter_id"]
            isOneToOne: false
            referencedRelation: "encounters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combat_actions_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combat_actions_target_character_id_fkey"
            columns: ["target_character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combat_actions_target_creature_id_fkey"
            columns: ["target_creature_id"]
            isOneToOne: false
            referencedRelation: "creatures"
            referencedColumns: ["id"]
          },
        ]
      }
      combat_audit_log: {
        Row: {
          character_id: string
          character_name: string | null
          created_at: string
          event_type: string | null
          id: number
          message: string
          node_id: string | null
          payload: Json | null
        }
        Insert: {
          character_id: string
          character_name?: string | null
          created_at?: string
          event_type?: string | null
          id?: number
          message: string
          node_id?: string | null
          payload?: Json | null
        }
        Update: {
          character_id?: string
          character_name?: string | null
          created_at?: string
          event_type?: string | null
          id?: number
          message?: string
          node_id?: string | null
          payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "combat_audit_log_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      combat_config: {
        Row: {
          created_at: string
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      combat_sessions: {
        Row: {
          character_id: string | null
          created_at: string
          engaged_creature_ids: string[]
          id: string
          last_tick_at: number
          member_buffs: Json
          node_id: string
          party_id: string | null
          recent_member_ids: Json
          tick_rate_ms: number
        }
        Insert: {
          character_id?: string | null
          created_at?: string
          engaged_creature_ids?: string[]
          id?: string
          last_tick_at: number
          member_buffs?: Json
          node_id: string
          party_id?: string | null
          recent_member_ids?: Json
          tick_rate_ms?: number
        }
        Update: {
          character_id?: string | null
          created_at?: string
          engaged_creature_ids?: string[]
          id?: string
          last_tick_at?: number
          member_buffs?: Json
          node_id?: string
          party_id?: string | null
          recent_member_ids?: Json
          tick_rate_ms?: number
        }
        Relationships: [
          {
            foreignKeyName: "combat_sessions_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: true
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combat_sessions_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combat_sessions_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: true
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      combat_soak_access: {
        Row: {
          character_id: string
          created_at: string
          expires_at: string
          id: string
          node_id: string
          note: string | null
        }
        Insert: {
          character_id: string
          created_at?: string
          expires_at: string
          id?: string
          node_id: string
          note?: string | null
        }
        Update: {
          character_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          node_id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "combat_soak_access_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: true
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combat_soak_access_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      combat_soak_scopes: {
        Row: {
          character_ids: string[]
          created_at: string
          creature_ids: string[]
          encounter_id: string | null
          expires_at: string
          granted_by: string | null
          id: string
          node_id: string
          updated_at: string
        }
        Insert: {
          character_ids?: string[]
          created_at?: string
          creature_ids?: string[]
          encounter_id?: string | null
          expires_at: string
          granted_by?: string | null
          id?: string
          node_id: string
          updated_at?: string
        }
        Update: {
          character_ids?: string[]
          created_at?: string
          creature_ids?: string[]
          encounter_id?: string | null
          expires_at?: string
          granted_by?: string | null
          id?: string
          node_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      creatures: {
        Row: {
          ac: number
          base_aggressive: boolean
          boss_cast: Json | null
          boss_crit_flavors: Json
          boss_death_cry: string
          created_at: string
          description: string
          died_at: string | null
          drop_chance: number
          hp: number
          id: string
          is_aggressive: boolean
          is_alive: boolean
          is_humanoid: boolean
          last_damaged_at: string | null
          level: number
          loot_mode: string
          loot_table: Json
          loot_table_id: string | null
          max_hp: number
          name: string
          node_id: string | null
          rarity: Database["public"]["Enums"]["creature_rarity"]
          respawn_seconds: number
          rewards_awarded_at: string | null
          spawn_seq: number
          stats: Json
        }
        Insert: {
          ac?: number
          base_aggressive?: boolean
          boss_cast?: Json | null
          boss_crit_flavors?: Json
          boss_death_cry?: string
          created_at?: string
          description?: string
          died_at?: string | null
          drop_chance?: number
          hp?: number
          id?: string
          is_aggressive?: boolean
          is_alive?: boolean
          is_humanoid?: boolean
          last_damaged_at?: string | null
          level?: number
          loot_mode?: string
          loot_table?: Json
          loot_table_id?: string | null
          max_hp?: number
          name: string
          node_id?: string | null
          rarity?: Database["public"]["Enums"]["creature_rarity"]
          respawn_seconds?: number
          rewards_awarded_at?: string | null
          spawn_seq?: number
          stats?: Json
        }
        Update: {
          ac?: number
          base_aggressive?: boolean
          boss_cast?: Json | null
          boss_crit_flavors?: Json
          boss_death_cry?: string
          created_at?: string
          description?: string
          died_at?: string | null
          drop_chance?: number
          hp?: number
          id?: string
          is_aggressive?: boolean
          is_alive?: boolean
          is_humanoid?: boolean
          last_damaged_at?: string | null
          level?: number
          loot_mode?: string
          loot_table?: Json
          loot_table_id?: string | null
          max_hp?: number
          name?: string
          node_id?: string | null
          rarity?: Database["public"]["Enums"]["creature_rarity"]
          respawn_seconds?: number
          rewards_awarded_at?: string | null
          spawn_seq?: number
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
      effects_catchup_dispatch: {
        Row: {
          attempt: number
          backoff_until: number
          completed_at: string | null
          dispatch_id: string
          due_at_ms: number
          encounter_id: string
          failures: number
          last_class: string | null
          last_error: string | null
          last_outcome: string | null
          last_status: number | null
          last_transport_error: string | null
          lease_until: number
          node_id: string
          request_generation: number | null
          request_id: number | null
          requested_at: string | null
          updated_at: string
        }
        Insert: {
          attempt?: number
          backoff_until?: number
          completed_at?: string | null
          dispatch_id: string
          due_at_ms: number
          encounter_id: string
          failures?: number
          last_class?: string | null
          last_error?: string | null
          last_outcome?: string | null
          last_status?: number | null
          last_transport_error?: string | null
          lease_until?: number
          node_id: string
          request_generation?: number | null
          request_id?: number | null
          requested_at?: string | null
          updated_at?: string
        }
        Update: {
          attempt?: number
          backoff_until?: number
          completed_at?: string | null
          dispatch_id?: string
          due_at_ms?: number
          encounter_id?: string
          failures?: number
          last_class?: string | null
          last_error?: string | null
          last_outcome?: string | null
          last_status?: number | null
          last_transport_error?: string | null
          lease_until?: number
          node_id?: string
          request_generation?: number | null
          request_id?: number | null
          requested_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      effects_catchup_log: {
        Row: {
          class: string | null
          created_at: string
          deaths: number | null
          dispatch_id: string | null
          due_age_ms: number | null
          duration_ms: number | null
          effects: number | null
          encounter_id: string | null
          id: number
          node_id: string | null
          outcome: string | null
          phase: string
          reason: string | null
          request_id: number | null
          scopes_claimed: number | null
          scopes_discovered: number | null
          status: number | null
          ticks: number | null
        }
        Insert: {
          class?: string | null
          created_at?: string
          deaths?: number | null
          dispatch_id?: string | null
          due_age_ms?: number | null
          duration_ms?: number | null
          effects?: number | null
          encounter_id?: string | null
          id?: number
          node_id?: string | null
          outcome?: string | null
          phase: string
          reason?: string | null
          request_id?: number | null
          scopes_claimed?: number | null
          scopes_discovered?: number | null
          status?: number | null
          ticks?: number | null
        }
        Update: {
          class?: string | null
          created_at?: string
          deaths?: number | null
          dispatch_id?: string | null
          due_age_ms?: number | null
          duration_ms?: number | null
          effects?: number | null
          encounter_id?: string | null
          id?: number
          node_id?: string | null
          outcome?: string | null
          phase?: string
          reason?: string | null
          request_id?: number | null
          scopes_claimed?: number | null
          scopes_discovered?: number | null
          status?: number | null
          ticks?: number | null
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      encounter_access_grants: {
        Row: {
          character_id: string
          encounter_id: string
          expires_at: string
          granted_at: string
        }
        Insert: {
          character_id: string
          encounter_id: string
          expires_at?: string
          granted_at?: string
        }
        Update: {
          character_id?: string
          encounter_id?: string
          expires_at?: string
          granted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "encounter_access_grants_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "encounter_access_grants_encounter_id_fkey"
            columns: ["encounter_id"]
            isOneToOne: false
            referencedRelation: "encounters"
            referencedColumns: ["id"]
          },
        ]
      }
      encounter_cast_events: {
        Row: {
          ability_key: string | null
          cast_key: string
          creature_id: string | null
          encounter_id: string
          expires_at: string | null
          id: string
          node_id: string | null
          payload: Json
          resolved_at: string | null
          started_at: string | null
        }
        Insert: {
          ability_key?: string | null
          cast_key: string
          creature_id?: string | null
          encounter_id: string
          expires_at?: string | null
          id?: string
          node_id?: string | null
          payload?: Json
          resolved_at?: string | null
          started_at?: string | null
        }
        Update: {
          ability_key?: string | null
          cast_key?: string
          creature_id?: string | null
          encounter_id?: string
          expires_at?: string | null
          id?: string
          node_id?: string | null
          payload?: Json
          resolved_at?: string | null
          started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "encounter_cast_events_creature_id_fkey"
            columns: ["creature_id"]
            isOneToOne: false
            referencedRelation: "creatures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "encounter_cast_events_encounter_id_fkey"
            columns: ["encounter_id"]
            isOneToOne: false
            referencedRelation: "encounters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "encounter_cast_events_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      encounter_creatures: {
        Row: {
          attached_at: string
          creature_id: string
          encounter_id: string
        }
        Insert: {
          attached_at?: string
          creature_id: string
          encounter_id: string
        }
        Update: {
          attached_at?: string
          creature_id?: string
          encounter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "encounter_creatures_creature_id_fkey"
            columns: ["creature_id"]
            isOneToOne: true
            referencedRelation: "creatures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "encounter_creatures_encounter_id_fkey"
            columns: ["encounter_id"]
            isOneToOne: false
            referencedRelation: "encounters"
            referencedColumns: ["id"]
          },
        ]
      }
      encounter_death_loot: {
        Row: {
          created_at: string
          creature_id: string
          death_id: string
          drop_chance: number
          encounter_id: string
          item_id: string | null
          loot_table_id: string | null
          mode: string
          resolved: boolean
          spawn_seq: number
          tick_number: number
        }
        Insert: {
          created_at?: string
          creature_id: string
          death_id: string
          drop_chance: number
          encounter_id: string
          item_id?: string | null
          loot_table_id?: string | null
          mode: string
          resolved?: boolean
          spawn_seq: number
          tick_number: number
        }
        Update: {
          created_at?: string
          creature_id?: string
          death_id?: string
          drop_chance?: number
          encounter_id?: string
          item_id?: string | null
          loot_table_id?: string | null
          mode?: string
          resolved?: boolean
          spawn_seq?: number
          tick_number?: number
        }
        Relationships: []
      }
      encounter_engagements: {
        Row: {
          character_id: string
          creature_id: string
          encounter_id: string
          joined_at: string
          last_action_at: string
          party_id_at_join: string | null
        }
        Insert: {
          character_id: string
          creature_id: string
          encounter_id: string
          joined_at?: string
          last_action_at?: string
          party_id_at_join?: string | null
        }
        Update: {
          character_id?: string
          creature_id?: string
          encounter_id?: string
          joined_at?: string
          last_action_at?: string
          party_id_at_join?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "encounter_engagements_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "encounter_engagements_creature_id_fkey"
            columns: ["creature_id"]
            isOneToOne: false
            referencedRelation: "creatures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "encounter_engagements_encounter_id_fkey"
            columns: ["encounter_id"]
            isOneToOne: false
            referencedRelation: "encounters"
            referencedColumns: ["id"]
          },
        ]
      }
      encounter_kill_awards: {
        Row: {
          award_kind: string
          character_id: string
          created_at: string
          creature_id: string
          death_id: string
          encounter_id: string
          spawn_seq: number
          tick_number: number
        }
        Insert: {
          award_kind: string
          character_id: string
          created_at?: string
          creature_id: string
          death_id: string
          encounter_id: string
          spawn_seq: number
          tick_number: number
        }
        Update: {
          award_kind?: string
          character_id?: string
          created_at?: string
          creature_id?: string
          death_id?: string
          encounter_id?: string
          spawn_seq?: number
          tick_number?: number
        }
        Relationships: []
      }
      encounter_participants: {
        Row: {
          character_id: string
          encounter_id: string
          generation: number
          joined_at: string
          last_action_at: string
          node_id: string | null
        }
        Insert: {
          character_id: string
          encounter_id: string
          generation?: number
          joined_at?: string
          last_action_at?: string
          node_id?: string | null
        }
        Update: {
          character_id?: string
          encounter_id?: string
          generation?: number
          joined_at?: string
          last_action_at?: string
          node_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "encounter_participants_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: true
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "encounter_participants_encounter_id_fkey"
            columns: ["encounter_id"]
            isOneToOne: false
            referencedRelation: "encounters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "encounter_participants_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      encounter_tick_batches: {
        Row: {
          batch_id: string
          created_at: string
          encounter_id: string
          payload: Json
          tick_number: number
        }
        Insert: {
          batch_id: string
          created_at?: string
          encounter_id: string
          payload?: Json
          tick_number: number
        }
        Update: {
          batch_id?: string
          created_at?: string
          encounter_id?: string
          payload?: Json
          tick_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "encounter_tick_batches_encounter_id_fkey"
            columns: ["encounter_id"]
            isOneToOne: false
            referencedRelation: "encounters"
            referencedColumns: ["id"]
          },
        ]
      }
      encounters: {
        Row: {
          attempt: number
          claim_token: string | null
          created_at: string
          encounter_key: string
          ended_at: string | null
          id: string
          last_activity_at: string
          lease_until: number | null
          next_tick_due_at: number
          node_id: string
          reserved_boundary_at: number | null
          resolver_id: string | null
          resolving_tick: number | null
          started_at: string
          state: Json
          status: string
          stored_power: number
          stored_power_cap: number | null
          stored_power_source_id: string | null
          tick_at: number
          tick_mode: string | null
          tick_number: number
          tick_owner: string
          tick_state: string
          updated_at: string
          version: number
        }
        Insert: {
          attempt?: number
          claim_token?: string | null
          created_at?: string
          encounter_key?: string
          ended_at?: string | null
          id?: string
          last_activity_at?: string
          lease_until?: number | null
          next_tick_due_at?: number
          node_id: string
          reserved_boundary_at?: number | null
          resolver_id?: string | null
          resolving_tick?: number | null
          started_at?: string
          state?: Json
          status?: string
          stored_power?: number
          stored_power_cap?: number | null
          stored_power_source_id?: string | null
          tick_at?: number
          tick_mode?: string | null
          tick_number?: number
          tick_owner?: string
          tick_state?: string
          updated_at?: string
          version?: number
        }
        Update: {
          attempt?: number
          claim_token?: string | null
          created_at?: string
          encounter_key?: string
          ended_at?: string | null
          id?: string
          last_activity_at?: string
          lease_until?: number | null
          next_tick_due_at?: number
          node_id?: string
          reserved_boundary_at?: number | null
          resolver_id?: string | null
          resolving_tick?: number | null
          started_at?: string
          state?: Json
          status?: string
          stored_power?: number
          stored_power_cap?: number | null
          stored_power_source_id?: string | null
          tick_at?: number
          tick_mode?: string | null
          tick_number?: number
          tick_owner?: string
          tick_state?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "encounters_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      families: {
        Row: {
          created_at: string
          display_name: string
          founder_user_id: string
          id: string
          key: string
        }
        Insert: {
          created_at?: string
          display_name: string
          founder_user_id: string
          id?: string
          key: string
        }
        Update: {
          created_at?: string
          display_name?: string
          founder_user_id?: string
          id?: string
          key?: string
        }
        Relationships: []
      }
      family_members: {
        Row: {
          family_id: string
          joined_at: string
          user_id: string
        }
        Insert: {
          family_id: string
          joined_at?: string
          user_id: string
        }
        Update: {
          family_id?: string
          joined_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_members_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      family_requests: {
        Row: {
          created_at: string
          family_id: string
          id: string
          requester_user_id: string
          resolved_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          family_id: string
          id?: string
          requester_user_id: string
          resolved_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          family_id?: string
          id?: string
          requester_user_id?: string
          resolved_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_requests_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      guide_categories: {
        Row: {
          created_at: string
          id: string
          is_published: boolean
          key: string
          sort_order: number
          subtitle: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_published?: boolean
          key: string
          sort_order?: number
          subtitle?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_published?: boolean
          key?: string
          sort_order?: number
          subtitle?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      guide_entries: {
        Row: {
          body: string
          category_id: string
          created_at: string
          id: string
          is_published: boolean
          slug: string
          sort_order: number
          summary: string | null
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          category_id: string
          created_at?: string
          id?: string
          is_published?: boolean
          slug: string
          sort_order?: number
          summary?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          category_id?: string
          created_at?: string
          id?: string
          is_published?: boolean
          slug?: string
          sort_order?: number
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guide_entries_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "guide_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      harness_run_registry: {
        Row: {
          created_at: string
          entity_id: string | null
          entity_text: string | null
          id: number
          kind: string
          run_id: string
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          entity_text?: string | null
          id?: number
          kind: string
          run_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          entity_text?: string | null
          id?: number
          kind?: string
          run_id?: string
        }
        Relationships: []
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
          appearance_key: string | null
          created_at: string
          description: string
          drop_weight: number
          hands: number | null
          id: string
          illustration_metadata: Json
          illustration_url: string
          is_soulbound: boolean
          item_type: string
          level: number
          map_flavor: string | null
          map_region_id: string | null
          map_target_node_id: string | null
          max_durability: number
          name: string
          origin_id: string | null
          origin_type: string | null
          procs: Json
          rarity: Database["public"]["Enums"]["item_rarity"]
          slot: Database["public"]["Enums"]["item_slot"] | null
          stats: Json
          tier: number | null
          value: number
          weapon_die: string | null
          weapon_tag: string | null
          world_drop: boolean
        }
        Insert: {
          appearance_key?: string | null
          created_at?: string
          description?: string
          drop_weight?: number
          hands?: number | null
          id?: string
          illustration_metadata?: Json
          illustration_url?: string
          is_soulbound?: boolean
          item_type?: string
          level?: number
          map_flavor?: string | null
          map_region_id?: string | null
          map_target_node_id?: string | null
          max_durability?: number
          name: string
          origin_id?: string | null
          origin_type?: string | null
          procs?: Json
          rarity?: Database["public"]["Enums"]["item_rarity"]
          slot?: Database["public"]["Enums"]["item_slot"] | null
          stats?: Json
          tier?: number | null
          value?: number
          weapon_die?: string | null
          weapon_tag?: string | null
          world_drop?: boolean
        }
        Update: {
          appearance_key?: string | null
          created_at?: string
          description?: string
          drop_weight?: number
          hands?: number | null
          id?: string
          illustration_metadata?: Json
          illustration_url?: string
          is_soulbound?: boolean
          item_type?: string
          level?: number
          map_flavor?: string | null
          map_region_id?: string | null
          map_target_node_id?: string | null
          max_durability?: number
          name?: string
          origin_id?: string | null
          origin_type?: string | null
          procs?: Json
          rarity?: Database["public"]["Enums"]["item_rarity"]
          slot?: Database["public"]["Enums"]["item_slot"] | null
          stats?: Json
          tier?: number | null
          value?: number
          weapon_die?: string | null
          weapon_tag?: string | null
          world_drop?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "items_appearance_key_fkey"
            columns: ["appearance_key"]
            isOneToOne: false
            referencedRelation: "appearance_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_map_region_id_fkey"
            columns: ["map_region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_map_target_node_id_fkey"
            columns: ["map_target_node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      loot_pool_config: {
        Row: {
          common_pct: number
          consumable_drop_chance: number
          consumable_level_max_offset: number
          consumable_level_min_offset: number
          drop_chance_boss: number
          drop_chance_rare: number
          drop_chance_regular: number
          equip_level_max_offset: number
          equip_level_min_offset: number
          id: number
          uncommon_pct: number
        }
        Insert: {
          common_pct?: number
          consumable_drop_chance?: number
          consumable_level_max_offset?: number
          consumable_level_min_offset?: number
          drop_chance_boss?: number
          drop_chance_rare?: number
          drop_chance_regular?: number
          equip_level_max_offset?: number
          equip_level_min_offset?: number
          id?: number
          uncommon_pct?: number
        }
        Update: {
          common_pct?: number
          consumable_drop_chance?: number
          consumable_level_max_offset?: number
          consumable_level_min_offset?: number
          drop_chance_boss?: number
          drop_chance_rare?: number
          drop_chance_regular?: number
          equip_level_max_offset?: number
          equip_level_min_offset?: number
          id?: number
          uncommon_pct?: number
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
      marketplace_listings: {
        Row: {
          buyer_character_id: string | null
          created_at: string
          current_durability: number
          expires_at: string
          id: string
          inventory_item_id: string | null
          item_id: string
          item_snapshot: Json
          payout_amount: number | null
          payout_collected_at: string | null
          price: number
          seller_character_id: string
          sold_at: string | null
          status: string
          tax_amount: number
          tax_rate: number
        }
        Insert: {
          buyer_character_id?: string | null
          created_at?: string
          current_durability?: number
          expires_at?: string
          id?: string
          inventory_item_id?: string | null
          item_id: string
          item_snapshot?: Json
          payout_amount?: number | null
          payout_collected_at?: string | null
          price: number
          seller_character_id: string
          sold_at?: string | null
          status?: string
          tax_amount?: number
          tax_rate?: number
        }
        Update: {
          buyer_character_id?: string | null
          created_at?: string
          current_durability?: number
          expires_at?: string
          id?: string
          inventory_item_id?: string | null
          item_id?: string
          item_snapshot?: Json
          payout_amount?: number | null
          payout_collected_at?: string | null
          price?: number
          seller_character_id?: string
          sold_at?: string | null
          status?: string
          tax_amount?: number
          tax_rate?: number
        }
        Relationships: []
      }
      materials: {
        Row: {
          category: string
          created_at: string
          description: string
          key: string
          name: string
          rarity: string
          sort_order: number
          stack_max: number | null
          tradeable: boolean
          value: number
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string
          key: string
          name: string
          rarity?: string
          sort_order?: number
          stack_max?: number | null
          tradeable?: boolean
          value?: number
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          key?: string
          name?: string
          rarity?: string
          sort_order?: number
          stack_max?: number | null
          tradeable?: boolean
          value?: number
        }
        Relationships: []
      }
      node_ground_loot: {
        Row: {
          applied_gems: Json
          crafted_level: number | null
          creature_name: string | null
          current_durability: number
          dropped_at: string
          dropped_by: string | null
          id: string
          item_id: string
          node_id: string
          stat_override: Json | null
        }
        Insert: {
          applied_gems?: Json
          crafted_level?: number | null
          creature_name?: string | null
          current_durability?: number
          dropped_at?: string
          dropped_by?: string | null
          id?: string
          item_id: string
          node_id: string
          stat_override?: Json | null
        }
        Update: {
          applied_gems?: Json
          crafted_level?: number | null
          creature_name?: string | null
          current_durability?: number
          dropped_at?: string
          dropped_by?: string | null
          id?: string
          item_id?: string
          node_id?: string
          stat_override?: Json | null
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
          class_hall: string | null
          connections: Json
          created_at: string
          description: string
          id: string
          illustration_metadata: Json | null
          illustration_url: string | null
          is_blacksmith: boolean
          is_heraldry: boolean
          is_inn: boolean
          is_jewelcrafter: boolean
          is_marketplace: boolean
          is_public_teleport: boolean
          is_soulforge: boolean
          is_stonebinder: boolean
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
          class_hall?: string | null
          connections?: Json
          created_at?: string
          description?: string
          id?: string
          illustration_metadata?: Json | null
          illustration_url?: string | null
          is_blacksmith?: boolean
          is_heraldry?: boolean
          is_inn?: boolean
          is_jewelcrafter?: boolean
          is_marketplace?: boolean
          is_public_teleport?: boolean
          is_soulforge?: boolean
          is_stonebinder?: boolean
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
          class_hall?: string | null
          connections?: Json
          created_at?: string
          description?: string
          id?: string
          illustration_metadata?: Json | null
          illustration_url?: string | null
          is_blacksmith?: boolean
          is_heraldry?: boolean
          is_inn?: boolean
          is_jewelcrafter?: boolean
          is_marketplace?: boolean
          is_public_teleport?: boolean
          is_soulforge?: boolean
          is_stonebinder?: boolean
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
            foreignKeyName: "nodes_class_hall_fkey"
            columns: ["class_hall"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["class_key"]
          },
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
          dialogue_topics: Json
          id: string
          name: string
          node_id: string | null
          service_role: string | null
        }
        Insert: {
          created_at?: string
          description?: string
          dialogue?: string
          dialogue_topics?: Json
          id?: string
          name: string
          node_id?: string | null
          service_role?: string | null
        }
        Update: {
          created_at?: string
          description?: string
          dialogue?: string
          dialogue_topics?: Json
          id?: string
          name?: string
          node_id?: string | null
          service_role?: string | null
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
          event: Json | null
          id: string
          message: string
          node_id: string | null
          party_id: string
        }
        Insert: {
          character_name?: string | null
          created_at?: string
          event?: Json | null
          id?: string
          message: string
          node_id?: string | null
          party_id: string
        }
        Update: {
          character_name?: string | null
          created_at?: string
          event?: Json | null
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
          full_name: string | null
          has_accepted_oath: boolean
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          full_name?: string | null
          has_accepted_oath?: boolean
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          full_name?: string | null
          has_accepted_oath?: boolean
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      races: {
        Row: {
          admin_notes: string | null
          cha: number
          con: number
          created_at: string
          description: string
          dex: number
          int: number
          is_selectable: boolean
          label: string
          portrait_notes: string
          race_key: string
          sort_order: number
          status: string
          str: number
          updated_at: string
          wis: number
        }
        Insert: {
          admin_notes?: string | null
          cha?: number
          con?: number
          created_at?: string
          description?: string
          dex?: number
          int?: number
          is_selectable?: boolean
          label: string
          portrait_notes?: string
          race_key: string
          sort_order?: number
          status?: string
          str?: number
          updated_at?: string
          wis?: number
        }
        Update: {
          admin_notes?: string | null
          cha?: number
          con?: number
          created_at?: string
          description?: string
          dex?: number
          int?: number
          is_selectable?: boolean
          label?: string
          portrait_notes?: string
          race_key?: string
          sort_order?: number
          status?: string
          str?: number
          updated_at?: string
          wis?: number
        }
        Relationships: []
      }
      regions: {
        Row: {
          created_at: string
          description: string
          direction: string | null
          id: string
          illustration_metadata: Json | null
          illustration_url: string | null
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
          illustration_metadata?: Json | null
          illustration_url?: string | null
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
          illustration_metadata?: Json | null
          illustration_url?: string | null
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
      simulation_pause_state: {
        Row: {
          id: number
          last_sim_at_ms: number | null
          resumed_at_ms: number | null
          suspended_at_ms: number | null
          updated_at: string
        }
        Insert: {
          id?: number
          last_sim_at_ms?: number | null
          resumed_at_ms?: number | null
          suspended_at_ms?: number | null
          updated_at?: string
        }
        Update: {
          id?: number
          last_sim_at_ms?: number | null
          resumed_at_ms?: number | null
          suspended_at_ms?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      summon_requests: {
        Row: {
          cp_cost: number
          created_at: string
          expires_at: string
          id: string
          status: string
          summoner_id: string
          summoner_node_id: string
          target_id: string
        }
        Insert: {
          cp_cost?: number
          created_at?: string
          expires_at?: string
          id?: string
          status?: string
          summoner_id: string
          summoner_node_id: string
          target_id: string
        }
        Update: {
          cp_cost?: number
          created_at?: string
          expires_at?: string
          id?: string
          status?: string
          summoner_id?: string
          summoner_node_id?: string
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "summon_requests_summoner_id_fkey"
            columns: ["summoner_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "summon_requests_summoner_node_id_fkey"
            columns: ["summoner_node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "summon_requests_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
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
      weapon_progression_config: {
        Row: {
          id: number
          tier1_level: number
          tier2_level: number
          tier3_level: number
          updated_at: string
        }
        Insert: {
          id?: number
          tier1_level?: number
          tier2_level?: number
          tier3_level?: number
          updated_at?: string
        }
        Update: {
          id?: number
          tier1_level?: number
          tier2_level?: number
          tier3_level?: number
          updated_at?: string
        }
        Relationships: []
      }
      world_slumber_log: {
        Row: {
          awake_characters: number
          changed_at: string
          id: number
          state: string
        }
        Insert: {
          awake_characters?: number
          changed_at?: string
          id?: number
          state: string
        }
        Update: {
          awake_characters?: number
          changed_at?: string
          id?: number
          state?: string
        }
        Relationships: []
      }
      world_state: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: number
          state: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: number
          state?: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: number
          state?: string
        }
        Relationships: []
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
      _family_name_is_reserved: { Args: { _key: string }; Returns: boolean }
      ability_config_version: { Args: never; Returns: string }
      ability_damage_type_keys: { Args: never; Returns: string[] }
      ability_damaging_mechanics: { Args: never; Returns: string[] }
      ability_mechanic_params: { Args: never; Returns: Json }
      ability_roll_based_mechanics: { Args: never; Returns: string[] }
      accept_party_invite: {
        Args: { _membership_id: string }
        Returns: undefined
      }
      accept_summon: { Args: { _request_id: string }; Returns: undefined }
      activate_cheat_xp_boost: { Args: never; Returns: Json }
      activate_stance: {
        Args: { p_character_id: string; p_stance_key: string; p_tier: number }
        Returns: Json
      }
      add_material: {
        Args: { _character_id: string; _delta: number; _key: string }
        Returns: number
      }
      admin_cancel_listing: { Args: { p_listing_id: string }; Returns: boolean }
      admin_teleport: {
        Args: { _character_id: string; _node_id: string }
        Returns: undefined
      }
      apply_contract_complete: {
        Args: { _character_id: string; _new_count: number }
        Returns: undefined
      }
      apply_crafting_xp: {
        Args: { p_character_id: string; p_xp: number }
        Returns: Json
      }
      apply_family_to_character: {
        Args: { _character_id: string; _display: string }
        Returns: Json
      }
      apply_force_shield_regen: {
        Args: { _character_id: string }
        Returns: Json
      }
      area_type_placeholder_url: {
        Args: { _area_type: string }
        Returns: string
      }
      arm_effects_catchup_for_node: {
        Args: { _node_id: string }
        Returns: boolean
      }
      assassin_abandon_contract: {
        Args: { _character_id: string }
        Returns: undefined
      }
      assassin_take_contract: { Args: { _character_id: string }; Returns: Json }
      assert_loadout_swap_allowed: {
        Args: { _character_id: string; _role_id: string }
        Returns: undefined
      }
      award_class_bond: {
        Args: { _amount: number; _character_id: string; _class: string }
        Returns: number
      }
      award_class_bond_for_kill: {
        Args: {
          _character_id: string
          _creature_level: number
          _is_boss?: boolean
        }
        Returns: number
      }
      award_party_member:
        | {
            Args: { _character_id: string; _gold: number; _xp: number }
            Returns: undefined
          }
        | {
            Args: {
              _bhp?: number
              _character_id: string
              _gold: number
              _salvage?: number
              _xp: number
            }
            Returns: undefined
          }
      buy_unique_listing: {
        Args: { p_character_id: string; p_listing_id: string }
        Returns: Json
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
      cancel_combat_action: {
        Args: { _id: string; _reason?: string }
        Returns: undefined
      }
      cancel_family_request: { Args: { _request_id: string }; Returns: Json }
      cancel_unique_listing: {
        Args: { p_character_id: string; p_listing_id: string }
        Returns: boolean
      }
      catchup_scope_check: {
        Args: { _character_id: string; _node_id: string; _user_id: string }
        Returns: string
      }
      change_family_at_heraldry: {
        Args: { _character_id: string; _display: string }
        Returns: Json
      }
      character_can_use_ability: {
        Args: { _ability_key: string; _character_id: string }
        Returns: boolean
      }
      check_family_name: { Args: { _display: string }; Returns: Json }
      claim_encounter_tick: {
        Args: {
          _caller: string
          _encounter_id: string
          _lease_ms: number
          _rate_ms: number
          _supported_modes: string[]
        }
        Returns: Json
      }
      cleanup_ground_loot: { Args: never; Returns: undefined }
      clear_ability_loadout: {
        Args: { _character_id: string; _role_id: string }
        Returns: undefined
      }
      clear_stances: { Args: { p_character_id: string }; Returns: Json }
      collect_marketplace_payouts: {
        Args: { p_character_id: string }
        Returns: Json
      }
      combat_soak_access_check: {
        Args: { _character_id: string; _node_id: string }
        Returns: boolean
      }
      commit_encounter_tick_v2: {
        Args: {
          _batch_id: string
          _claim_token: string
          _encounter_id: string
          _encounter_version: number
          _proposed: Json
          _snapshot_digest: Json
          _snapshot_scope: Json
          _snapshot_version: number
          _tick: number
        }
        Returns: Json
      }
      commit_encounter_tick_v3: {
        Args: {
          _batch_id: string
          _claim_token: string
          _encounter_id: string
          _encounter_version: number
          _proposed: Json
          _reserved_boundary_at?: number
          _snapshot_digest: Json
          _snapshot_scope: Json
          _snapshot_version: number
          _tick: number
        }
        Returns: Json
      }
      consume_maps_for_node: {
        Args: { _character_id: string; _node_id: string }
        Returns: number
      }
      consume_material: {
        Args: { _character_id: string; _delta: number; _key: string }
        Returns: boolean
      }
      crown_king_slayer: { Args: { _character_id: string }; Returns: undefined }
      damage_party_member: {
        Args: { _character_id: string; _damage: number }
        Returns: number
      }
      decline_summon: { Args: { _request_id: string }; Returns: undefined }
      degrade_party_member_equipment: {
        Args: { _character_id: string }
        Returns: undefined
      }
      delete_character_cascade: {
        Args: { _character_id: string }
        Returns: string
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      drop_item_to_ground: {
        Args: { p_character_id: string; p_inventory_id: string }
        Returns: boolean
      }
      drop_stance: {
        Args: { p_character_id: string; p_stance_key: string }
        Returns: Json
      }
      effects_catchup_credential_health: { Args: never; Returns: Json }
      effects_catchup_dispatch_one: {
        Args: { _encounter_id: string }
        Returns: Json
      }
      effects_catchup_reconcile: { Args: { _max?: number }; Returns: Json }
      effects_catchup_send: {
        Args: {
          _dispatch_id: string
          _due_at_ms: number
          _encounter_id: string
          _generation: number
          _node_id: string
        }
        Returns: number
      }
      effects_dispatch_token_check: {
        Args: { _token_sha256: string }
        Returns: boolean
      }
      effects_due_dispatch: { Args: { _max_scopes?: number }; Returns: Json }
      effects_due_scopes: {
        Args: { _limit?: number; _now_ms?: number }
        Returns: {
          due_at_ms: number
          due_count: number
          earliest_ms: number
          encounter_id: string
          live_owner: boolean
          node_id: string
          pending_count: number
        }[]
      }
      effects_scope_grant_check: {
        Args: { _encounter_id: string; _node_id: string }
        Returns: boolean
      }
      effects_scope_revalidate: {
        Args: { _due_at_ms?: number; _encounter_id: string; _node_id: string }
        Returns: string
      }
      effects_transport_snapshot: { Args: { _node_id?: string }; Returns: Json }
      email_queue_dispatch: { Args: never; Returns: undefined }
      encounter_apply_character_damage: {
        Args: {
          _amount: number
          _character_id: string
          _source_creature_id?: string
          _source_kind: string
        }
        Returns: {
          caused_death: boolean
          encounter_id: string
          new_hp: number
          old_hp: number
        }[]
      }
      encounter_apply_character_heal: {
        Args: { _amount: number; _character_id: string; _source_kind: string }
        Returns: {
          encounter_id: string
          hit_max: boolean
          new_hp: number
          old_hp: number
        }[]
      }
      encounter_apply_character_resource: {
        Args: {
          _character_id: string
          _delta: number
          _resource: string
          _source_kind: string
        }
        Returns: {
          encounter_id: string
          hit_max: boolean
          hit_zero: boolean
          new_value: number
          old_value: number
        }[]
      }
      encounter_apply_damage: {
        Args: {
          _amount: number
          _creature_id: string
          _source_character_id: string
          _source_kind: string
        }
        Returns: {
          caused_kill: boolean
          encounter_id: string
          new_hp: number
          old_hp: number
          turned_aggressive: boolean
        }[]
      }
      encounter_apply_heal: {
        Args: {
          _amount: number
          _creature_id: string
          _source_character_id: string
          _source_kind: string
        }
        Returns: {
          encounter_id: string
          new_hp: number
          old_hp: number
        }[]
      }
      encounter_attribution_roster: {
        Args: { _encounter_id: string }
        Returns: {
          character_id: string
        }[]
      }
      encounter_boss_fizzle_cast: {
        Args: { _cast_event_id: string }
        Returns: boolean
      }
      encounter_boss_resolve_cast: {
        Args: { _cast_event_id: string }
        Returns: {
          amount: number
          caused_death: boolean
          character_id: string
          locked_until: string
          new_hp: number
          old_hp: number
        }[]
      }
      encounter_boss_start_cast: {
        Args: {
          _ability_key: string
          _cast_key: string
          _cast_ms: number
          _creature_id: string
          _encounter_id: string
          _node_id: string
          _payload?: Json
        }
        Returns: {
          cast_event_id: string
          expires_at: string
          skipped: boolean
          started_at: string
        }[]
      }
      encounter_death_id: {
        Args: {
          _creature_id: string
          _encounter_id: string
          _spawn_seq: number
          _tick: number
        }
        Returns: string
      }
      encounter_detach_creature: {
        Args: { _creature_id: string; _encounter_id: string }
        Returns: undefined
      }
      encounter_disengage: { Args: { _character_id: string }; Returns: number }
      encounter_end: { Args: { _encounter_id: string }; Returns: undefined }
      encounter_end_participation: {
        Args: { _character_id: string; _node_id: string }
        Returns: Json
      }
      encounter_engage: { Args: { _character_id: string }; Returns: string }
      encounter_ensure_for_character: {
        Args: { _character_id: string }
        Returns: string
      }
      encounter_ensure_for_creature: {
        Args: { _creature_id: string }
        Returns: string
      }
      encounter_for_node: { Args: { _node_id: string }; Returns: string }
      encounter_has_pending_work: {
        Args: { _encounter_id: string }
        Returns: boolean
      }
      encounter_intake: {
        Args: { _character_id: string; _creature_ids?: string[] }
        Returns: Json
      }
      encounter_live_owner_active: {
        Args: { _encounter_id: string }
        Returns: boolean
      }
      encounter_lock_key: { Args: { _encounter_id: string }; Returns: number }
      encounter_reconcile: {
        Args: { _node_id: string }
        Returns: {
          encounter_id: string
          participants_purged: number
          sessions_reset: number
          status_after: string
        }[]
      }
      encounter_resync_snapshot: {
        Args: { _character_id: string; _encounter_id: string }
        Returns: Json
      }
      encounter_snapshot_v2: {
        Args: { _claim_token: string; _encounter_id: string; _tick: number }
        Returns: Json
      }
      encounter_state_digest: {
        Args: { _encounter_id: string; _scope: Json }
        Returns: Json
      }
      encounter_stored_power_add: {
        Args: {
          _delta: number
          _encounter_id: string
          _reason?: string
          _source_id?: string
        }
        Returns: number
      }
      encounter_stored_power_consume: {
        Args: {
          _encounter_id: string
          _fixed?: number
          _mode: string
          _pct?: number
        }
        Returns: number
      }
      encounter_stored_power_set_cap: {
        Args: { _cap: number; _encounter_id: string }
        Returns: undefined
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      expire_king_slayer: { Args: never; Returns: undefined }
      expire_marketplace_listings: { Args: never; Returns: number }
      final_maintenance_sweep: { Args: never; Returns: undefined }
      find_character_id_by_name: { Args: { _name: string }; Returns: string }
      forge_soulring: {
        Args: { p_character_id: string; p_stats: Json }
        Returns: Json
      }
      get_app_secret: { Args: { _key: string }; Returns: string }
      get_character_name: { Args: { _character_id: string }; Returns: string }
      get_my_admin_role: { Args: never; Returns: string }
      get_order_roster: {
        Args: { _class: string }
        Returns: {
          bond: number
          character_id: string
          class: string
          family_name: string
          level: number
          name: string
        }[]
      }
      get_renown_leaderboard: {
        Args: { _limit?: number }
        Returns: {
          class: string
          id: string
          level: number
          name: string
          rp_total_earned: number
        }[]
      }
      get_renown_rank: { Args: { _character_id: string }; Returns: number }
      grant_npc_gift: {
        Args: {
          _character_id: string
          _item_id: string
          _npc_id: string
          _once_per_character?: boolean
        }
        Returns: Json
      }
      grant_searched_item: {
        Args: { p_character_id: string; p_item_id: string }
        Returns: boolean
      }
      guarded_cleanup_ground_loot: { Args: never; Returns: undefined }
      guarded_expire_king_slayer: { Args: never; Returns: undefined }
      guarded_expire_marketplace_listings: { Args: never; Returns: undefined }
      guarded_expire_timed_state: { Args: never; Returns: undefined }
      guarded_prune_combat_audit_log: { Args: never; Returns: undefined }
      guarded_prune_effects_catchup_log: { Args: never; Returns: undefined }
      guarded_prune_encounter_access_grants: { Args: never; Returns: undefined }
      guarded_prune_encounter_tick_batches: { Args: never; Returns: undefined }
      guarded_prune_terminal_combat_actions: { Args: never; Returns: undefined }
      guarded_return_unique_items: { Args: never; Returns: undefined }
      guarded_sweep_stranded_encounters: { Args: never; Returns: undefined }
      harness_cron_snapshot: { Args: never; Returns: Json }
      harness_fail_closed: { Args: { _run_id: string }; Returns: Json }
      harness_teardown: { Args: { _run_id: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      heal_creatures_on_wake: { Args: never; Returns: number }
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
      idle_shutdown_check: { Args: never; Returns: undefined }
      inspect_character_equipment: {
        Args: { _character_id: string }
        Returns: {
          applied_gems: Json
          description: string
          durability_pct: number
          hands: number
          illustration_url: string
          is_soulbound: boolean
          item_level: number
          item_name: string
          item_type: string
          rarity: string
          slot: string
          stat_override: Json
          stats: Json
          weapon_tag: string
        }[]
      }
      is_overlord: { Args: never; Returns: boolean }
      is_party_mate: { Args: { _character_id: string }; Returns: boolean }
      is_party_member: { Args: { _party_id: string }; Returns: boolean }
      is_steward_or_overlord: { Args: never; Returns: boolean }
      join_encounter_engagement: {
        Args: { _character_id: string; _creature_id: string }
        Returns: string
      }
      join_order: {
        Args: { _character_id: string; _class: string }
        Returns: Json
      }
      leave_encounter_engagements: {
        Args: { _character_id: string; _creature_id?: string }
        Returns: undefined
      }
      leave_family: { Args: { _family_id: string }; Returns: Json }
      list_unique_item: {
        Args: {
          p_character_id: string
          p_inventory_id: string
          p_price: number
        }
        Returns: Json
      }
      move_follower: {
        Args: { _character_id: string; _node_id: string }
        Returns: undefined
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      node_creature_roster: { Args: { _character_id: string }; Returns: Json }
      owns_character: { Args: { _character_id: string }; Returns: boolean }
      pickup_ground_loot: {
        Args: { p_character_id: string; p_loot_id: string }
        Returns: boolean
      }
      prune_combat_audit_log: { Args: never; Returns: undefined }
      prune_cron_history: { Args: never; Returns: undefined }
      prune_effects_catchup_log: { Args: { _keep?: number }; Returns: number }
      prune_encounter_access_grants: {
        Args: { _limit?: number }
        Returns: number
      }
      prune_encounter_tick_batches: {
        Args: { _limit?: number; _older_than_seconds?: number }
        Returns: number
      }
      prune_terminal_combat_actions: {
        Args: { _limit?: number; _older_than_seconds?: number }
        Returns: number
      }
      purge_creature_engagements: {
        Args: { _creature_id: string }
        Returns: undefined
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      record_effects_catchup_result: {
        Args: {
          _deaths?: number
          _dispatch_id: string
          _duration_ms?: number
          _effects?: number
          _encounter_id: string
          _outcome: string
          _reason?: string
          _ticks?: number
        }
        Returns: string
      }
      record_world_state: { Args: never; Returns: undefined }
      redact_transport_text: { Args: { _text: string }; Returns: string }
      regen_creature_hp: { Args: never; Returns: undefined }
      release_encounter_tick: {
        Args: {
          _claim_token: string
          _encounter_id: string
          _reason?: string
          _tick: number
        }
        Returns: Json
      }
      renew_encounter_tick_lease: {
        Args: {
          _claim_token: string
          _encounter_id: string
          _extend_ms: number
          _resolver_id: string
          _tick: number
        }
        Returns: Json
      }
      request_family_membership: { Args: { _display: string }; Returns: Json }
      resolve_family_request: {
        Args: { _approve: boolean; _request_id: string }
        Returns: Json
      }
      respawn_creatures: { Args: never; Returns: undefined }
      return_unique_items: { Args: never; Returns: undefined }
      revoke_family_membership: {
        Args: { _family_id: string; _user_id: string }
        Returns: Json
      }
      schedule_effects_catchup: { Args: never; Returns: undefined }
      schedule_tick_creatures: { Args: never; Returns: undefined }
      sell_item: {
        Args: { p_character_id: string; p_inventory_id: string }
        Returns: number
      }
      set_ability_loadout: {
        Args: { _ability_id: string; _character_id: string; _role_id: string }
        Returns: undefined
      }
      set_assignment_default: {
        Args: { _assignment_id: string }
        Returns: undefined
      }
      set_character_combat_trace: {
        Args: { _character_id: string; _enabled: boolean }
        Returns: undefined
      }
      shutdown_world: { Args: never; Returns: undefined }
      sim_note_progress: { Args: never; Returns: undefined }
      sim_note_resume: { Args: never; Returns: undefined }
      sim_note_suspend: { Args: never; Returns: undefined }
      simulation_pause_boundary: { Args: never; Returns: Json }
      status_config_problems: {
        Args: never
        Returns: {
          ability_key: string
          code: string
          detail: string
          status_key: string
        }[]
      }
      stonebinder_commit_fuse: {
        Args: {
          p_ascended_item_id: string
          p_character_id: string
          p_durability: number
          p_source_inv_a: string
          p_source_inv_b: string
        }
        Returns: string
      }
      submit_combat_action: {
        Args: {
          _ability_key: string
          _character_id: string
          _client_seq?: number
          _id: string
          _target_character_id?: string
          _target_creature_id?: string
        }
        Returns: {
          ability_key: string
          character_id: string
          client_seq: number
          consumed_tick: number | null
          created_at: string
          eligible_after_ms: number | null
          encounter_id: string
          id: string
          node_id: string
          reject_reason: string | null
          status: string
          submitted_at: string
          target_character_id: string | null
          target_creature_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "combat_actions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sweep_stranded_encounters: {
        Args: { _idle_seconds?: number; _limit?: number }
        Returns: {
          closed: boolean
          encounter_id: string
        }[]
      }
      switch_order: {
        Args: { _character_id: string; _class: string }
        Returns: Json
      }
      sync_character_resources: {
        Args: { p_character_id: string }
        Returns: Json
      }
      tick_creatures: { Args: never; Returns: undefined }
      train_renown_stat: {
        Args: { _character_id: string; _stat: string }
        Returns: Json
      }
      try_acquire_unique_item: {
        Args: { p_character_id: string; p_item_id: string }
        Returns: boolean
      }
      unschedule_effects_catchup: { Args: never; Returns: undefined }
      unschedule_tick_creatures: { Args: never; Returns: undefined }
      update_party_member_hp: {
        Args: { _character_id: string; _new_hp: number }
        Returns: undefined
      }
      validate_ability_calc: {
        Args: { _calc: Json; _depth?: number; _label: string }
        Returns: string
      }
      wake_world: { Args: never; Returns: Json }
      world_is_awake: { Args: never; Returns: boolean }
      world_state_is_awake: { Args: never; Returns: boolean }
      world_watchdog: { Args: never; Returns: undefined }
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
      character_gender: "male" | "female"
      character_race:
        | "human"
        | "elf"
        | "dwarf"
        | "halfling"
        | "edain"
        | "half_elf"
      creature_rarity: "regular" | "rare" | "boss"
      item_rarity: "common" | "uncommon" | "unique" | "soulforged"
      item_slot:
        | "head"
        | "chest"
        | "gloves"
        | "pants"
        | "ring"
        | "ring_2"
        | "trinket"
        | "main_hand"
        | "off_hand"
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
      item_rarity: ["common", "uncommon", "unique", "soulforged"],
      item_slot: [
        "head",
        "chest",
        "gloves",
        "pants",
        "ring",
        "ring_2",
        "trinket",
        "main_hand",
        "off_hand",
      ],
    },
  },
} as const
