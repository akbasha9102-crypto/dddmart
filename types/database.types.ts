/**
 * Supabase database schema types for DDD Mart.
 * Mirrors the SQL schema (see supabase/schema.sql if present) — keep in sync
 * manually until `supabase gen types typescript` is wired to a live project.
 */

export type PaymentMethod = "cash" | "credit";
export type UserRole = "admin" | "cashier";
export type OperationActionType =
  | "sale_created"
  | "product_created"
  | "product_updated"
  | "product_deleted"
  | "category_created"
  | "category_updated"
  | "category_deleted"
  | "stock_adjusted"
  | "stock_received"
  | "return_created"
  | "damage_recorded"
  | "customer_created"
  | "customer_updated"
  | "customer_archived"
  | "customer_payment_recorded";
export type OperationEntityType = "product" | "category" | "sale" | "stock" | "customer";
export type CustomerTransactionType = "sale" | "payment";

export interface Database {
  public: {
    Tables: {
      stores: {
        Row: {
          id: string;
          name: string;
          slug: string;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string;
          role: UserRole;
          is_active: boolean;
          store_id: string;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name: string;
          role?: UserRole;
          is_active?: boolean;
          store_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          role?: UserRole;
          is_active?: boolean;
          store_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          id: string;
          name: string;
          sort_order: number;
          is_active: boolean;
          color: string;
          icon: string;
          store_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          sort_order?: number;
          is_active?: boolean;
          color?: string;
          icon?: string;
          store_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          sort_order?: number;
          is_active?: boolean;
          color?: string;
          icon?: string;
          store_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          name: string;
          barcode: string;
          category_id: string | null;
          cost_price: number;
          sale_price: number;
          quantity: number;
          min_stock_threshold: number;
          unit: string;
          is_active: boolean;
          store_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          barcode: string;
          category_id?: string | null;
          cost_price?: number;
          sale_price: number;
          quantity?: number;
          min_stock_threshold?: number;
          unit?: string;
          is_active?: boolean;
          store_id: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          barcode?: string;
          category_id?: string | null;
          cost_price?: number;
          sale_price?: number;
          quantity?: number;
          min_stock_threshold?: number;
          unit?: string;
          is_active?: boolean;
          store_id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      sales: {
        Row: {
          id: string;
          invoice_number: string;
          cashier_id: string | null;
          subtotal: number;
          discount_amount: number;
          total_amount: number;
          paid_amount: number;
          change_amount: number;
          payment_method: PaymentMethod;
          customer_id: string | null;
          store_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          invoice_number: string;
          cashier_id?: string | null;
          subtotal: number;
          discount_amount?: number;
          total_amount: number;
          paid_amount: number;
          change_amount?: number;
          payment_method?: PaymentMethod;
          customer_id?: string | null;
          store_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          invoice_number?: string;
          cashier_id?: string | null;
          subtotal?: number;
          discount_amount?: number;
          total_amount?: number;
          paid_amount?: number;
          change_amount?: number;
          payment_method?: PaymentMethod;
          customer_id?: string | null;
          store_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sales_cashier_id_fkey";
            columns: ["cashier_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      sale_items: {
        Row: {
          id: string;
          sale_id: string;
          product_id: string | null;
          product_name: string;
          barcode: string;
          quantity: number;
          unit_price: number;
          total_price: number;
          unit_label: string | null;
          unit_conversion_factor: number;
          cost_price: number;
          store_id: string;
        };
        Insert: {
          id?: string;
          sale_id: string;
          product_id?: string | null;
          product_name: string;
          barcode: string;
          quantity: number;
          unit_price: number;
          total_price: number;
          unit_label?: string | null;
          unit_conversion_factor?: number;
          cost_price?: number;
          store_id: string;
        };
        Update: {
          id?: string;
          sale_id?: string;
          product_id?: string | null;
          product_name?: string;
          barcode?: string;
          quantity?: number;
          unit_price?: number;
          total_price?: number;
          unit_label?: string | null;
          unit_conversion_factor?: number;
          cost_price?: number;
          store_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sale_items_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      product_units: {
        Row: {
          id: string;
          product_id: string;
          unit_name: string;
          conversion_factor: number;
          barcode: string;
          sale_price: number;
          sort_order: number;
          is_active: boolean;
          store_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          unit_name: string;
          conversion_factor: number;
          barcode: string;
          sale_price: number;
          sort_order?: number;
          is_active?: boolean;
          store_id: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          product_id?: string;
          unit_name?: string;
          conversion_factor?: number;
          barcode?: string;
          sale_price?: number;
          sort_order?: number;
          is_active?: boolean;
          store_id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_units_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      returns: {
        Row: {
          id: string;
          sale_id: string;
          sale_item_id: string;
          product_id: string | null;
          product_name: string;
          quantity: number;
          unit_label: string | null;
          unit_conversion_factor: number;
          refund_amount: number;
          reason: string | null;
          actor_id: string | null;
          store_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          sale_id: string;
          sale_item_id: string;
          product_id?: string | null;
          product_name: string;
          quantity: number;
          unit_label?: string | null;
          unit_conversion_factor?: number;
          refund_amount: number;
          reason?: string | null;
          actor_id?: string | null;
          store_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          sale_id?: string;
          sale_item_id?: string;
          product_id?: string | null;
          product_name?: string;
          quantity?: number;
          unit_label?: string | null;
          unit_conversion_factor?: number;
          refund_amount?: number;
          reason?: string | null;
          actor_id?: string | null;
          store_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "returns_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "returns_sale_item_id_fkey";
            columns: ["sale_item_id"];
            isOneToOne: false;
            referencedRelation: "sale_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "returns_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "returns_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_damages: {
        Row: {
          id: string;
          product_id: string | null;
          product_name: string;
          quantity: number;
          cost_price: number;
          loss_amount: number;
          reason: string | null;
          actor_id: string | null;
          store_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          product_id?: string | null;
          product_name: string;
          quantity: number;
          cost_price: number;
          loss_amount: number;
          reason?: string | null;
          actor_id?: string | null;
          store_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          product_id?: string | null;
          product_name?: string;
          quantity?: number;
          cost_price?: number;
          loss_amount?: number;
          reason?: string | null;
          actor_id?: string | null;
          store_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_damages_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_damages_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      held_sales: {
        Row: {
          id: string;
          cashier_id: string | null;
          items: Record<string, unknown>[];
          discount_amount: number;
          note: string | null;
          store_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          cashier_id?: string | null;
          items: Record<string, unknown>[];
          discount_amount?: number;
          note?: string | null;
          store_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          cashier_id?: string | null;
          items?: Record<string, unknown>[];
          discount_amount?: number;
          note?: string | null;
          store_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "held_sales_cashier_id_fkey";
            columns: ["cashier_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      customers: {
        Row: {
          id: string;
          name: string;
          phone: string | null;
          credit_limit: number;
          notes: string | null;
          is_active: boolean;
          store_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          phone?: string | null;
          credit_limit?: number;
          notes?: string | null;
          is_active?: boolean;
          store_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          phone?: string | null;
          credit_limit?: number;
          notes?: string | null;
          is_active?: boolean;
          store_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      customer_transactions: {
        Row: {
          id: string;
          customer_id: string;
          type: CustomerTransactionType;
          amount: number;
          sale_id: string | null;
          note: string | null;
          store_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          customer_id: string;
          type: CustomerTransactionType;
          amount: number;
          sale_id?: string | null;
          note?: string | null;
          store_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          customer_id?: string;
          type?: CustomerTransactionType;
          amount?: number;
          sale_id?: string | null;
          note?: string | null;
          store_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_transactions_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_transactions_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
        ];
      };
      operations_log: {
        Row: {
          id: string;
          user_id: string | null;
          action_type: OperationActionType;
          entity_type: OperationEntityType;
          entity_id: string | null;
          description: string;
          metadata: Record<string, unknown>;
          store_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          action_type: OperationActionType;
          entity_type: OperationEntityType;
          entity_id?: string | null;
          description: string;
          metadata?: Record<string, unknown>;
          store_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          action_type?: OperationActionType;
          entity_type?: OperationEntityType;
          entity_id?: string | null;
          description?: string;
          metadata?: Record<string, unknown>;
          store_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "operations_log_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      customer_balances: {
        Row: {
          customer_id: string;
          balance: number;
        };
        Relationships: [];
      };
    };
    Functions: {
      adjust_product_stock: {
        Args: { p_product_id: string; p_delta: number };
        Returns: Database["public"]["Tables"]["products"]["Row"][];
      };
      receive_product_stock: {
        Args: { p_product_id: string; p_added_base_units: number; p_unit_base_cost: number };
        Returns: Database["public"]["Tables"]["products"]["Row"][];
      };
    };
    Enums: Record<string, never>;
  };
}
