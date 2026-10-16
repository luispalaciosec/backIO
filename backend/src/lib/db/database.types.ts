/**
 * GENERADO por scripts/gen_tipos_db.ts desde el esquema de PostgREST. No editar a mano: correr `pnpm db:types`.
 */
// jsonb sin estructura fija en la base: se tipa como unknown y su forma la fijan los tipos de @backio/shared.
export type Json = unknown;

export type Database = {
  public: {
    Tables: {
      actas: {
        Row: {
          id: string;
          tenant_id: string;
          semana_id: string;
          tipo: string;
          contenido: Json;
          markdown: string;
          publicado_at: string | null;
          publicado_por: string | null;
          basecamp_doc_id: number | null;
          created_at: string;
          mesa_id: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          semana_id: string;
          tipo: string;
          contenido?: Json;
          markdown: string;
          publicado_at?: string | null;
          publicado_por?: string | null;
          basecamp_doc_id?: number | null;
          created_at?: string;
          mesa_id?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          semana_id?: string;
          tipo?: string;
          contenido?: Json;
          markdown?: string;
          publicado_at?: string | null;
          publicado_por?: string | null;
          basecamp_doc_id?: number | null;
          created_at?: string;
          mesa_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'actas_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'actas_semana_id_fkey';
            columns: ['semana_id'];
            isOneToOne: false;
            referencedRelation: 'semanas';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'actas_publicado_por_fkey';
            columns: ['publicado_por'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'actas_mesa_id_fkey';
            columns: ['mesa_id'];
            isOneToOne: false;
            referencedRelation: 'mesas';
            referencedColumns: ['id'];
          },
        ];
      };
      acuerdos: {
        Row: {
          id: string;
          tenant_id: string;
          semana_id: string;
          descripcion: string;
          responsable_id: string;
          fecha_compromiso: string;
          estado: string;
          cerrado_at: string | null;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          semana_id: string;
          descripcion: string;
          responsable_id: string;
          fecha_compromiso: string;
          estado?: string;
          cerrado_at?: string | null;
          created_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          semana_id?: string;
          descripcion?: string;
          responsable_id?: string;
          fecha_compromiso?: string;
          estado?: string;
          cerrado_at?: string | null;
          created_at?: string;
          created_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'acuerdos_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'acuerdos_semana_id_fkey';
            columns: ['semana_id'];
            isOneToOne: false;
            referencedRelation: 'semanas';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'acuerdos_responsable_id_fkey';
            columns: ['responsable_id'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'acuerdos_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
        ];
      };
      agent_plans: {
        Row: {
          id: string;
          tenant_id: string;
          api_key_id: string | null;
          tool: string;
          parametros: Json;
          plan: Json;
          expira_at: string;
          ejecutado_at: string | null;
          resultado: Json | null;
          created_at: string;
          usuario_id: string | null;
        };
        Insert: {
          id: string;
          tenant_id: string;
          api_key_id?: string | null;
          tool: string;
          parametros?: Json;
          plan?: Json;
          expira_at: string;
          ejecutado_at?: string | null;
          resultado?: Json | null;
          created_at?: string;
          usuario_id?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          api_key_id?: string | null;
          tool?: string;
          parametros?: Json;
          plan?: Json;
          expira_at?: string;
          ejecutado_at?: string | null;
          resultado?: Json | null;
          created_at?: string;
          usuario_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'agent_plans_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'agent_plans_api_key_id_fkey';
            columns: ['api_key_id'];
            isOneToOne: false;
            referencedRelation: 'api_keys';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'agent_plans_usuario_id_fkey';
            columns: ['usuario_id'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
        ];
      };
      api_keys: {
        Row: {
          id: string;
          tenant_id: string;
          nombre: string;
          prefijo: string;
          key_hash: string;
          scopes: string[];
          perfil: string | null;
          creado_por: string | null;
          ultimo_uso_at: string | null;
          revocada_at: string | null;
          created_at: string;
          cliente_id: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          nombre: string;
          prefijo: string;
          key_hash: string;
          scopes?: string[];
          perfil?: string | null;
          creado_por?: string | null;
          ultimo_uso_at?: string | null;
          revocada_at?: string | null;
          created_at?: string;
          cliente_id?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          nombre?: string;
          prefijo?: string;
          key_hash?: string;
          scopes?: string[];
          perfil?: string | null;
          creado_por?: string | null;
          ultimo_uso_at?: string | null;
          revocada_at?: string | null;
          created_at?: string;
          cliente_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'api_keys_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'api_keys_creado_por_fkey';
            columns: ['creado_por'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'api_keys_cliente_id_fkey';
            columns: ['cliente_id'];
            isOneToOne: false;
            referencedRelation: 'clientes';
            referencedColumns: ['id'];
          },
        ];
      };
      aprobacion_eventos: {
        Row: {
          id: string;
          tenant_id: string;
          requerimiento_id: string;
          estado_de: string | null;
          estado_a: string;
          ronda: number;
          usuario_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          requerimiento_id: string;
          estado_de?: string | null;
          estado_a: string;
          ronda?: number;
          usuario_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          requerimiento_id?: string;
          estado_de?: string | null;
          estado_a?: string;
          ronda?: number;
          usuario_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'aprobacion_eventos_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'aprobacion_eventos_requerimiento_id_fkey';
            columns: ['requerimiento_id'];
            isOneToOne: false;
            referencedRelation: 'requerimientos';
            referencedColumns: ['id'];
          },
        ];
      };
      audit_log: {
        Row: {
          id: number;
          tenant_id: string;
          sistema: string;
          usuario_id: string | null;
          api_key_id: string | null;
          origen: string;
          accion: string;
          entidad: string;
          entidad_id: string | null;
          detalle: Json | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          tenant_id: string;
          sistema?: string;
          usuario_id?: string | null;
          api_key_id?: string | null;
          origen: string;
          accion: string;
          entidad: string;
          entidad_id?: string | null;
          detalle?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          tenant_id?: string;
          sistema?: string;
          usuario_id?: string | null;
          api_key_id?: string | null;
          origen?: string;
          accion?: string;
          entidad?: string;
          entidad_id?: string | null;
          detalle?: Json | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_log_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audit_log_usuario_id_fkey';
            columns: ['usuario_id'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audit_log_api_key_id_fkey';
            columns: ['api_key_id'];
            isOneToOne: false;
            referencedRelation: 'api_keys';
            referencedColumns: ['id'];
          },
        ];
      };
      basecamp_credenciales_usuario: {
        Row: {
          usuario_id: string;
          tenant_id: string;
          basecamp_person_id: number;
          datos: Json;
          conectado_at: string;
          updated_at: string;
        };
        Insert: {
          usuario_id: string;
          tenant_id: string;
          basecamp_person_id: number;
          datos?: Json;
          conectado_at?: string;
          updated_at?: string;
        };
        Update: {
          usuario_id?: string;
          tenant_id?: string;
          basecamp_person_id?: number;
          datos?: Json;
          conectado_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'basecamp_credenciales_usuario_usuario_id_fkey';
            columns: ['usuario_id'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'basecamp_credenciales_usuario_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      basecamp_huerfanos: {
        Row: {
          id: string;
          tenant_id: string;
          cliente_id: string;
          basecamp_project_id: number;
          basecamp_todolist_id: number | null;
          basecamp_todo_id: number;
          titulo: string;
          creador_basecamp_id: number | null;
          creador_nombre: string | null;
          due_on: string | null;
          completed: boolean;
          app_url: string | null;
          detectado_at: string;
          resuelto_at: string | null;
          resolucion: string | null;
          requerimiento_id: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          cliente_id: string;
          basecamp_project_id: number;
          basecamp_todolist_id?: number | null;
          basecamp_todo_id: number;
          titulo: string;
          creador_basecamp_id?: number | null;
          creador_nombre?: string | null;
          due_on?: string | null;
          completed?: boolean;
          app_url?: string | null;
          detectado_at?: string;
          resuelto_at?: string | null;
          resolucion?: string | null;
          requerimiento_id?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          cliente_id?: string;
          basecamp_project_id?: number;
          basecamp_todolist_id?: number | null;
          basecamp_todo_id?: number;
          titulo?: string;
          creador_basecamp_id?: number | null;
          creador_nombre?: string | null;
          due_on?: string | null;
          completed?: boolean;
          app_url?: string | null;
          detectado_at?: string;
          resuelto_at?: string | null;
          resolucion?: string | null;
          requerimiento_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'basecamp_huerfanos_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'basecamp_huerfanos_cliente_id_fkey';
            columns: ['cliente_id'];
            isOneToOne: false;
            referencedRelation: 'clientes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'basecamp_huerfanos_requerimiento_id_fkey';
            columns: ['requerimiento_id'];
            isOneToOne: false;
            referencedRelation: 'requerimientos';
            referencedColumns: ['id'];
          },
        ];
      };
      bitacora: {
        Row: {
          id: string;
          tenant_id: string;
          requerimiento_id: string;
          usuario_id: string | null;
          nota: string;
          estado_operativo: string | null;
          estado_aprobacion: string | null;
          visible_cliente: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          requerimiento_id: string;
          usuario_id?: string | null;
          nota: string;
          estado_operativo?: string | null;
          estado_aprobacion?: string | null;
          visible_cliente?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          requerimiento_id?: string;
          usuario_id?: string | null;
          nota?: string;
          estado_operativo?: string | null;
          estado_aprobacion?: string | null;
          visible_cliente?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'bitacora_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bitacora_requerimiento_id_fkey';
            columns: ['requerimiento_id'];
            isOneToOne: false;
            referencedRelation: 'requerimientos';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bitacora_usuario_id_fkey';
            columns: ['usuario_id'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
        ];
      };
      clientes: {
        Row: {
          id: string;
          tenant_id: string;
          nombre: string;
          slug: string;
          logo_url: string | null;
          color_primario: string | null;
          basecamp_project_id: number | null;
          config: Json;
          activo: boolean;
          created_at: string;
          updated_at: string;
          created_by: string | null;
          updated_by: string | null;
          deleted_at: string | null;
          mesa_id: string | null;
          basecamp_importado_at: string | null;
        };
        Insert: {
          id: string;
          tenant_id: string;
          nombre: string;
          slug: string;
          logo_url?: string | null;
          color_primario?: string | null;
          basecamp_project_id?: number | null;
          config?: Json;
          activo?: boolean;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
          updated_by?: string | null;
          deleted_at?: string | null;
          mesa_id?: string | null;
          basecamp_importado_at?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          nombre?: string;
          slug?: string;
          logo_url?: string | null;
          color_primario?: string | null;
          basecamp_project_id?: number | null;
          config?: Json;
          activo?: boolean;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
          updated_by?: string | null;
          deleted_at?: string | null;
          mesa_id?: string | null;
          basecamp_importado_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'clientes_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'clientes_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'clientes_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'clientes_mesa_id_fkey';
            columns: ['mesa_id'];
            isOneToOne: false;
            referencedRelation: 'mesas';
            referencedColumns: ['id'];
          },
        ];
      };
      cron_runs: {
        Row: {
          job: string;
          ventana: string;
          inicio_at: string;
          fin_at: string | null;
          ok: boolean | null;
          detalle: string | null;
        };
        Insert: {
          job: string;
          ventana: string;
          inicio_at?: string;
          fin_at?: string | null;
          ok?: boolean | null;
          detalle?: string | null;
        };
        Update: {
          job?: string;
          ventana?: string;
          inicio_at?: string;
          fin_at?: string | null;
          ok?: boolean | null;
          detalle?: string | null;
        };
        Relationships: [];
      };
      daily_snapshots: {
        Row: {
          id: string;
          tenant_id: string;
          mesa_id: string;
          fecha: string;
          metricas: Json;
          seleccion: string[];
          por_persona: Json;
          origen: string;
          publicado: boolean;
          apertura_publicada: boolean;
          message_id: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          mesa_id: string;
          fecha: string;
          metricas?: Json;
          seleccion?: string[];
          por_persona?: Json;
          origen: string;
          publicado?: boolean;
          apertura_publicada?: boolean;
          message_id?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          mesa_id?: string;
          fecha?: string;
          metricas?: Json;
          seleccion?: string[];
          por_persona?: Json;
          origen?: string;
          publicado?: boolean;
          apertura_publicada?: boolean;
          message_id?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'daily_snapshots_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'daily_snapshots_mesa_id_fkey';
            columns: ['mesa_id'];
            isOneToOne: false;
            referencedRelation: 'mesas';
            referencedColumns: ['id'];
          },
        ];
      };
      horas: {
        Row: {
          id: string;
          tenant_id: string;
          cliente_id: string | null;
          requerimiento_id: string | null;
          usuario_id: string | null;
          basecamp_entry_id: number;
          basecamp_person_id: number | null;
          basecamp_todo_id: number | null;
          basecamp_project_id: number | null;
          fecha: string;
          horas: number;
          sincronizado_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          cliente_id?: string | null;
          requerimiento_id?: string | null;
          usuario_id?: string | null;
          basecamp_entry_id: number;
          basecamp_person_id?: number | null;
          basecamp_todo_id?: number | null;
          basecamp_project_id?: number | null;
          fecha: string;
          horas: number;
          sincronizado_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          cliente_id?: string | null;
          requerimiento_id?: string | null;
          usuario_id?: string | null;
          basecamp_entry_id?: number;
          basecamp_person_id?: number | null;
          basecamp_todo_id?: number | null;
          basecamp_project_id?: number | null;
          fecha?: string;
          horas?: number;
          sincronizado_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'horas_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'horas_cliente_id_fkey';
            columns: ['cliente_id'];
            isOneToOne: false;
            referencedRelation: 'clientes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'horas_requerimiento_id_fkey';
            columns: ['requerimiento_id'];
            isOneToOne: false;
            referencedRelation: 'requerimientos';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'horas_usuario_id_fkey';
            columns: ['usuario_id'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
        ];
      };
      ia_generaciones: {
        Row: {
          id: string;
          tenant_id: string;
          tipo: string;
          entidad_tipo: string | null;
          entidad_id: string | null;
          payload_hash: string;
          texto: string;
          datos: Json | null;
          modelo: string;
          tokens_entrada: number | null;
          tokens_salida: number | null;
          creado_por: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          tipo: string;
          entidad_tipo?: string | null;
          entidad_id?: string | null;
          payload_hash: string;
          texto: string;
          datos?: Json | null;
          modelo: string;
          tokens_entrada?: number | null;
          tokens_salida?: number | null;
          creado_por?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          tipo?: string;
          entidad_tipo?: string | null;
          entidad_id?: string | null;
          payload_hash?: string;
          texto?: string;
          datos?: Json | null;
          modelo?: string;
          tokens_entrada?: number | null;
          tokens_salida?: number | null;
          creado_por?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ia_generaciones_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ia_generaciones_creado_por_fkey';
            columns: ['creado_por'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
        ];
      };
      integracion_credenciales: {
        Row: {
          tenant_id: string;
          proveedor: string;
          datos: Json;
          updated_at: string;
        };
        Insert: {
          tenant_id: string;
          proveedor: string;
          datos?: Json;
          updated_at?: string;
        };
        Update: {
          tenant_id?: string;
          proveedor?: string;
          datos?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'integracion_credenciales_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      invitaciones: {
        Row: {
          id: string;
          tenant_id: string;
          email: string;
          nombre: string;
          rol: 'admin' | 'gerencia' | 'operaciones' | 'ejecutiva' | 'lider' | 'colaborador';
          capacidad_semanal: number;
          usada_at: string | null;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          email: string;
          nombre: string;
          rol?: 'admin' | 'gerencia' | 'operaciones' | 'ejecutiva' | 'lider' | 'colaborador';
          capacidad_semanal?: number;
          usada_at?: string | null;
          created_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          email?: string;
          nombre?: string;
          rol?: 'admin' | 'gerencia' | 'operaciones' | 'ejecutiva' | 'lider' | 'colaborador';
          capacidad_semanal?: number;
          usada_at?: string | null;
          created_at?: string;
          created_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'invitaciones_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invitaciones_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
        ];
      };
      kpi_definiciones: {
        Row: {
          id: string;
          tenant_id: string;
          codigo: string;
          area: string;
          indicador: string;
          periodicidad: string;
          operador: string;
          meta: number;
          tipo: string;
          numerador_label: string;
          denominador_label: string;
          denominador_fijo: number | null;
          calculo: string;
          fuente: string | null;
          regla: string | null;
          formula: string | null;
          activo: boolean;
          orden: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          codigo: string;
          area: string;
          indicador: string;
          periodicidad?: string;
          operador?: string;
          meta: number;
          tipo?: string;
          numerador_label: string;
          denominador_label: string;
          denominador_fijo?: number | null;
          calculo?: string;
          fuente?: string | null;
          regla?: string | null;
          formula?: string | null;
          activo?: boolean;
          orden?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          codigo?: string;
          area?: string;
          indicador?: string;
          periodicidad?: string;
          operador?: string;
          meta?: number;
          tipo?: string;
          numerador_label?: string;
          denominador_label?: string;
          denominador_fijo?: number | null;
          calculo?: string;
          fuente?: string | null;
          regla?: string | null;
          formula?: string | null;
          activo?: boolean;
          orden?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'kpi_definiciones_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      kpi_mediciones: {
        Row: {
          id: string;
          tenant_id: string;
          kpi_id: string;
          periodo: string;
          usuario_id: string | null;
          dato_a: number | null;
          dato_b: number | null;
          meta_individual: number | null;
          origen: string;
          justificacion_ajuste: string | null;
          tasa_respuesta: number | null;
          causa: string | null;
          atribuible: string | null;
          evidencia_url: string | null;
          plan_mejora: string | null;
          responsable_id: string | null;
          fecha_seguimiento: string | null;
          registrado_por: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          kpi_id: string;
          periodo: string;
          usuario_id?: string | null;
          dato_a?: number | null;
          dato_b?: number | null;
          meta_individual?: number | null;
          origen?: string;
          justificacion_ajuste?: string | null;
          tasa_respuesta?: number | null;
          causa?: string | null;
          atribuible?: string | null;
          evidencia_url?: string | null;
          plan_mejora?: string | null;
          responsable_id?: string | null;
          fecha_seguimiento?: string | null;
          registrado_por?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          kpi_id?: string;
          periodo?: string;
          usuario_id?: string | null;
          dato_a?: number | null;
          dato_b?: number | null;
          meta_individual?: number | null;
          origen?: string;
          justificacion_ajuste?: string | null;
          tasa_respuesta?: number | null;
          causa?: string | null;
          atribuible?: string | null;
          evidencia_url?: string | null;
          plan_mejora?: string | null;
          responsable_id?: string | null;
          fecha_seguimiento?: string | null;
          registrado_por?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'kpi_mediciones_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'kpi_mediciones_kpi_id_fkey';
            columns: ['kpi_id'];
            isOneToOne: false;
            referencedRelation: 'kpi_definiciones';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'kpi_mediciones_usuario_id_fkey';
            columns: ['usuario_id'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'kpi_mediciones_responsable_id_fkey';
            columns: ['responsable_id'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'kpi_mediciones_registrado_por_fkey';
            columns: ['registrado_por'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
        ];
      };
      limites: {
        Row: {
          clave: string;
          ventana_inicio: string;
          n: number;
          bloqueado_hasta: string | null;
        };
        Insert: {
          clave: string;
          ventana_inicio: string;
          n?: number;
          bloqueado_hasta?: string | null;
        };
        Update: {
          clave?: string;
          ventana_inicio?: string;
          n?: number;
          bloqueado_hasta?: string | null;
        };
        Relationships: [];
      };
      mapeo_servicios: {
        Row: {
          id: string;
          tenant_id: string;
          servicio_prometio: string;
          plantilla_id: string | null;
          bloque_nombre: string | null;
          tipo_pieza_id: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          servicio_prometio: string;
          plantilla_id?: string | null;
          bloque_nombre?: string | null;
          tipo_pieza_id?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          servicio_prometio?: string;
          plantilla_id?: string | null;
          bloque_nombre?: string | null;
          tipo_pieza_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'mapeo_servicios_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'mapeo_servicios_plantilla_id_fkey';
            columns: ['plantilla_id'];
            isOneToOne: false;
            referencedRelation: 'plantillas';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'mapeo_servicios_tipo_pieza_id_fkey';
            columns: ['tipo_pieza_id'];
            isOneToOne: false;
            referencedRelation: 'tipos_pieza';
            referencedColumns: ['id'];
          },
        ];
      };
      mesas: {
        Row: {
          id: string;
          tenant_id: string;
          nombre: string;
          slug: string;
          basecamp_project_id: number | null;
          lider_id: string | null;
          color: string | null;
          activa: boolean;
          created_at: string;
          updated_at: string;
          basecamp_board_daily_id: number | null;
          basecamp_board_weekly_id: number | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          nombre: string;
          slug: string;
          basecamp_project_id?: number | null;
          lider_id?: string | null;
          color?: string | null;
          activa?: boolean;
          created_at?: string;
          updated_at?: string;
          basecamp_board_daily_id?: number | null;
          basecamp_board_weekly_id?: number | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          nombre?: string;
          slug?: string;
          basecamp_project_id?: number | null;
          lider_id?: string | null;
          color?: string | null;
          activa?: boolean;
          created_at?: string;
          updated_at?: string;
          basecamp_board_daily_id?: number | null;
          basecamp_board_weekly_id?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'mesas_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'mesas_lider_id_fkey';
            columns: ['lider_id'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
        ];
      };
      notas_cuenta: {
        Row: {
          id: string;
          tenant_id: string;
          requerimiento_id: string;
          autor_id: string;
          cuerpo: string;
          visible_cliente: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          requerimiento_id: string;
          autor_id: string;
          cuerpo: string;
          visible_cliente?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          requerimiento_id?: string;
          autor_id?: string;
          cuerpo?: string;
          visible_cliente?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notas_cuenta_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notas_cuenta_requerimiento_id_fkey';
            columns: ['requerimiento_id'];
            isOneToOne: false;
            referencedRelation: 'requerimientos';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notas_cuenta_autor_id_fkey';
            columns: ['autor_id'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
        ];
      };
      notificaciones: {
        Row: {
          id: string;
          tenant_id: string;
          usuario_id: string | null;
          canal: string;
          tipo: string;
          titulo: string;
          cuerpo: string | null;
          entidad_tipo: string | null;
          entidad_id: string | null;
          enviada_at: string | null;
          leida_at: string | null;
          created_at: string;
          email_destino: string | null;
          intentos: number;
          ultimo_error: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          usuario_id?: string | null;
          canal?: string;
          tipo: string;
          titulo: string;
          cuerpo?: string | null;
          entidad_tipo?: string | null;
          entidad_id?: string | null;
          enviada_at?: string | null;
          leida_at?: string | null;
          created_at?: string;
          email_destino?: string | null;
          intentos?: number;
          ultimo_error?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          usuario_id?: string | null;
          canal?: string;
          tipo?: string;
          titulo?: string;
          cuerpo?: string | null;
          entidad_tipo?: string | null;
          entidad_id?: string | null;
          enviada_at?: string | null;
          leida_at?: string | null;
          created_at?: string;
          email_destino?: string | null;
          intentos?: number;
          ultimo_error?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'notificaciones_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notificaciones_usuario_id_fkey';
            columns: ['usuario_id'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
        ];
      };
      oauth_clients: {
        Row: {
          id: string;
          secret_hash: string | null;
          nombre: string;
          redirect_uris: string[];
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id: string;
          secret_hash?: string | null;
          nombre: string;
          redirect_uris?: string[];
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          secret_hash?: string | null;
          nombre?: string;
          redirect_uris?: string[];
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      oauth_codes: {
        Row: {
          code: string;
          client_id: string;
          redirect_uri: string;
          code_challenge: string;
          scope: string;
          tenant_id: string;
          usuario_id: string;
          expira_at: string;
          usado_at: string | null;
          created_at: string;
        };
        Insert: {
          code: string;
          client_id: string;
          redirect_uri: string;
          code_challenge: string;
          scope?: string;
          tenant_id: string;
          usuario_id: string;
          expira_at: string;
          usado_at?: string | null;
          created_at?: string;
        };
        Update: {
          code?: string;
          client_id?: string;
          redirect_uri?: string;
          code_challenge?: string;
          scope?: string;
          tenant_id?: string;
          usuario_id?: string;
          expira_at?: string;
          usado_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'oauth_codes_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'oauth_clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'oauth_codes_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'oauth_codes_usuario_id_fkey';
            columns: ['usuario_id'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
        ];
      };
      oauth_tokens: {
        Row: {
          token_hash: string;
          tipo: string;
          client_id: string;
          tenant_id: string;
          usuario_id: string;
          scope: string;
          expira_at: string;
          revocado_at: string | null;
          created_at: string;
        };
        Insert: {
          token_hash: string;
          tipo: string;
          client_id: string;
          tenant_id: string;
          usuario_id: string;
          scope?: string;
          expira_at: string;
          revocado_at?: string | null;
          created_at?: string;
        };
        Update: {
          token_hash?: string;
          tipo?: string;
          client_id?: string;
          tenant_id?: string;
          usuario_id?: string;
          scope?: string;
          expira_at?: string;
          revocado_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'oauth_tokens_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'oauth_clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'oauth_tokens_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'oauth_tokens_usuario_id_fkey';
            columns: ['usuario_id'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
        ];
      };
      plantilla_bloques: {
        Row: {
          id: string;
          tenant_id: string;
          plantilla_id: string;
          nombre: string;
          peso: number;
          orden: number;
          opcional: boolean;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          plantilla_id: string;
          nombre: string;
          peso: number;
          orden: number;
          opcional?: boolean;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          plantilla_id?: string;
          nombre?: string;
          peso?: number;
          orden?: number;
          opcional?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'plantilla_bloques_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'plantilla_bloques_plantilla_id_fkey';
            columns: ['plantilla_id'];
            isOneToOne: false;
            referencedRelation: 'plantillas';
            referencedColumns: ['id'];
          },
        ];
      };
      plantilla_tareas: {
        Row: {
          id: string;
          tenant_id: string;
          bloque_id: string;
          titulo_interno: string;
          etiqueta_cliente: string | null;
          visible_cliente_default: boolean;
          peso_relativo: number;
          dias_offset: number;
          rol_sugerido: string | null;
          orden: number;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          bloque_id: string;
          titulo_interno: string;
          etiqueta_cliente?: string | null;
          visible_cliente_default?: boolean;
          peso_relativo?: number;
          dias_offset?: number;
          rol_sugerido?: string | null;
          orden: number;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          bloque_id?: string;
          titulo_interno?: string;
          etiqueta_cliente?: string | null;
          visible_cliente_default?: boolean;
          peso_relativo?: number;
          dias_offset?: number;
          rol_sugerido?: string | null;
          orden?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'plantilla_tareas_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'plantilla_tareas_bloque_id_fkey';
            columns: ['bloque_id'];
            isOneToOne: false;
            referencedRelation: 'plantilla_bloques';
            referencedColumns: ['id'];
          },
        ];
      };
      plantillas: {
        Row: {
          id: string;
          tenant_id: string;
          nombre: string;
          descripcion: string | null;
          tipo: 'campana' | 'lanzamiento' | 'fee_mensual' | 'pieza_suelta' | 'trade';
          activa: boolean;
          created_at: string;
          updated_at: string;
          recurrente: boolean;
          patron_nombre: string | null;
          pilar: string | null;
          familia: string | null;
          unidad: string | null;
          precio_referencia: string | null;
          cliente_id: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          nombre: string;
          descripcion?: string | null;
          tipo: 'campana' | 'lanzamiento' | 'fee_mensual' | 'pieza_suelta' | 'trade';
          activa?: boolean;
          created_at?: string;
          updated_at?: string;
          recurrente?: boolean;
          patron_nombre?: string | null;
          pilar?: string | null;
          familia?: string | null;
          unidad?: string | null;
          precio_referencia?: string | null;
          cliente_id?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          nombre?: string;
          descripcion?: string | null;
          tipo?: 'campana' | 'lanzamiento' | 'fee_mensual' | 'pieza_suelta' | 'trade';
          activa?: boolean;
          created_at?: string;
          updated_at?: string;
          recurrente?: boolean;
          patron_nombre?: string | null;
          pilar?: string | null;
          familia?: string | null;
          unidad?: string | null;
          precio_referencia?: string | null;
          cliente_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'plantillas_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'plantillas_cliente_id_fkey';
            columns: ['cliente_id'];
            isOneToOne: false;
            referencedRelation: 'clientes';
            referencedColumns: ['id'];
          },
        ];
      };
      portal_pines: {
        Row: {
          cliente_id: string;
          tenant_id: string;
          hash: string;
          updated_at: string;
        };
        Insert: {
          cliente_id: string;
          tenant_id: string;
          hash: string;
          updated_at?: string;
        };
        Update: {
          cliente_id?: string;
          tenant_id?: string;
          hash?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'portal_pines_cliente_id_fkey';
            columns: ['cliente_id'];
            isOneToOne: false;
            referencedRelation: 'clientes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'portal_pines_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      portal_resumenes: {
        Row: {
          proyecto_id: string;
          tenant_id: string;
          payload_hash: string;
          resumen: string;
          generado_at: string;
        };
        Insert: {
          proyecto_id: string;
          tenant_id: string;
          payload_hash: string;
          resumen: string;
          generado_at?: string;
        };
        Update: {
          proyecto_id?: string;
          tenant_id?: string;
          payload_hash?: string;
          resumen?: string;
          generado_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'portal_resumenes_proyecto_id_fkey';
            columns: ['proyecto_id'];
            isOneToOne: false;
            referencedRelation: 'proyectos';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'portal_resumenes_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      proyecto_borradores: {
        Row: {
          id: string;
          tenant_id: string;
          cliente_id: string;
          prometio_cotizacion_id: string;
          plantilla_sugerida_id: string | null;
          payload: Json;
          estado: string;
          proyecto_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          cliente_id: string;
          prometio_cotizacion_id: string;
          plantilla_sugerida_id?: string | null;
          payload?: Json;
          estado?: string;
          proyecto_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          cliente_id?: string;
          prometio_cotizacion_id?: string;
          plantilla_sugerida_id?: string | null;
          payload?: Json;
          estado?: string;
          proyecto_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'proyecto_borradores_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'proyecto_borradores_cliente_id_fkey';
            columns: ['cliente_id'];
            isOneToOne: false;
            referencedRelation: 'clientes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'proyecto_borradores_plantilla_sugerida_id_fkey';
            columns: ['plantilla_sugerida_id'];
            isOneToOne: false;
            referencedRelation: 'plantillas';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'proyecto_borradores_proyecto_id_fkey';
            columns: ['proyecto_id'];
            isOneToOne: false;
            referencedRelation: 'proyectos';
            referencedColumns: ['id'];
          },
        ];
      };
      proyectos: {
        Row: {
          id: string;
          tenant_id: string;
          cliente_id: string;
          plantilla_id: string | null;
          prometio_cotizacion_id: string | null;
          nombre: string;
          brief: Json;
          fecha_inicio: string;
          fecha_entrega: string;
          owner_ejecutiva: string | null;
          estado: 'backlog' | 'priorizado' | 'en_ejecucion' | 'en_revision' | 'reprogramado' | 'bloqueado' | 'completado' | 'cancelado';
          basecamp_todoset_id: number | null;
          basecamp_todolist_id: number | null;
          sync_estado: 'pendiente' | 'ok' | 'incompleto';
          portal_token: string | null;
          portal_activo: boolean;
          created_at: string;
          updated_at: string;
          created_by: string | null;
          updated_by: string | null;
          deleted_at: string | null;
          mesa_id: string | null;
          basecamp_grupos: Json;
          valor_cotizado: number | null;
          recurrencia_id: string | null;
          periodo: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          cliente_id: string;
          plantilla_id?: string | null;
          prometio_cotizacion_id?: string | null;
          nombre: string;
          brief?: Json;
          fecha_inicio: string;
          fecha_entrega: string;
          owner_ejecutiva?: string | null;
          estado?: 'backlog' | 'priorizado' | 'en_ejecucion' | 'en_revision' | 'reprogramado' | 'bloqueado' | 'completado' | 'cancelado';
          basecamp_todoset_id?: number | null;
          basecamp_todolist_id?: number | null;
          sync_estado?: 'pendiente' | 'ok' | 'incompleto';
          portal_token?: string | null;
          portal_activo?: boolean;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
          updated_by?: string | null;
          deleted_at?: string | null;
          mesa_id?: string | null;
          basecamp_grupos?: Json;
          valor_cotizado?: number | null;
          recurrencia_id?: string | null;
          periodo?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          cliente_id?: string;
          plantilla_id?: string | null;
          prometio_cotizacion_id?: string | null;
          nombre?: string;
          brief?: Json;
          fecha_inicio?: string;
          fecha_entrega?: string;
          owner_ejecutiva?: string | null;
          estado?: 'backlog' | 'priorizado' | 'en_ejecucion' | 'en_revision' | 'reprogramado' | 'bloqueado' | 'completado' | 'cancelado';
          basecamp_todoset_id?: number | null;
          basecamp_todolist_id?: number | null;
          sync_estado?: 'pendiente' | 'ok' | 'incompleto';
          portal_token?: string | null;
          portal_activo?: boolean;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
          updated_by?: string | null;
          deleted_at?: string | null;
          mesa_id?: string | null;
          basecamp_grupos?: Json;
          valor_cotizado?: number | null;
          recurrencia_id?: string | null;
          periodo?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'proyectos_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'proyectos_cliente_id_fkey';
            columns: ['cliente_id'];
            isOneToOne: false;
            referencedRelation: 'clientes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'proyectos_plantilla_id_fkey';
            columns: ['plantilla_id'];
            isOneToOne: false;
            referencedRelation: 'plantillas';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'proyectos_owner_ejecutiva_fkey';
            columns: ['owner_ejecutiva'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'proyectos_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'proyectos_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'proyectos_mesa_id_fkey';
            columns: ['mesa_id'];
            isOneToOne: false;
            referencedRelation: 'mesas';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'proyectos_recurrencia_id_fkey';
            columns: ['recurrencia_id'];
            isOneToOne: false;
            referencedRelation: 'recurrencias';
            referencedColumns: ['id'];
          },
        ];
      };
      recurrencias: {
        Row: {
          id: string;
          tenant_id: string;
          cliente_id: string;
          plantilla_id: string;
          nombre_patron: string;
          brief: Json;
          bloques: Json;
          owner_ejecutiva: string | null;
          dia_generacion: number;
          activa: boolean;
          ultimo_mes_generado: string | null;
          ultimo_proyecto_id: string | null;
          proyecto_origen_id: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          cliente_id: string;
          plantilla_id: string;
          nombre_patron: string;
          brief?: Json;
          bloques?: Json;
          owner_ejecutiva?: string | null;
          dia_generacion?: number;
          activa?: boolean;
          ultimo_mes_generado?: string | null;
          ultimo_proyecto_id?: string | null;
          proyecto_origen_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          cliente_id?: string;
          plantilla_id?: string;
          nombre_patron?: string;
          brief?: Json;
          bloques?: Json;
          owner_ejecutiva?: string | null;
          dia_generacion?: number;
          activa?: boolean;
          ultimo_mes_generado?: string | null;
          ultimo_proyecto_id?: string | null;
          proyecto_origen_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'recurrencias_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'recurrencias_cliente_id_fkey';
            columns: ['cliente_id'];
            isOneToOne: false;
            referencedRelation: 'clientes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'recurrencias_plantilla_id_fkey';
            columns: ['plantilla_id'];
            isOneToOne: false;
            referencedRelation: 'plantillas';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'recurrencias_owner_ejecutiva_fkey';
            columns: ['owner_ejecutiva'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'recurrencias_ultimo_proyecto_id_fkey';
            columns: ['ultimo_proyecto_id'];
            isOneToOne: false;
            referencedRelation: 'proyectos';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'recurrencias_proyecto_origen_id_fkey';
            columns: ['proyecto_origen_id'];
            isOneToOne: false;
            referencedRelation: 'proyectos';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'recurrencias_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
        ];
      };
      reprocesos: {
        Row: {
          id: string;
          tenant_id: string;
          requerimiento_id: string;
          origen: string;
          motivo: string | null;
          paso_retorno: string | null;
          fecha_entrega_antes: string | null;
          abierto_at: string;
          cerrado_at: string | null;
          horas_reproceso: number | null;
          usuario_id: string | null;
          created_at: string;
          observacion: string | null;
          area_responsable: string | null;
          atribuible: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          requerimiento_id: string;
          origen: string;
          motivo?: string | null;
          paso_retorno?: string | null;
          fecha_entrega_antes?: string | null;
          abierto_at?: string;
          cerrado_at?: string | null;
          horas_reproceso?: number | null;
          usuario_id?: string | null;
          created_at?: string;
          observacion?: string | null;
          area_responsable?: string | null;
          atribuible?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          requerimiento_id?: string;
          origen?: string;
          motivo?: string | null;
          paso_retorno?: string | null;
          fecha_entrega_antes?: string | null;
          abierto_at?: string;
          cerrado_at?: string | null;
          horas_reproceso?: number | null;
          usuario_id?: string | null;
          created_at?: string;
          observacion?: string | null;
          area_responsable?: string | null;
          atribuible?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'reprocesos_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reprocesos_requerimiento_id_fkey';
            columns: ['requerimiento_id'];
            isOneToOne: false;
            referencedRelation: 'requerimientos';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reprocesos_usuario_id_fkey';
            columns: ['usuario_id'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
        ];
      };
      reprogramaciones: {
        Row: {
          id: string;
          tenant_id: string;
          requerimiento_id: string;
          fecha_anterior: string | null;
          fecha_nueva: string | null;
          motivo: string | null;
          origen: string;
          usuario_id: string | null;
          created_at: string;
          observacion: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          requerimiento_id: string;
          fecha_anterior?: string | null;
          fecha_nueva?: string | null;
          motivo?: string | null;
          origen?: string;
          usuario_id?: string | null;
          created_at?: string;
          observacion?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          requerimiento_id?: string;
          fecha_anterior?: string | null;
          fecha_nueva?: string | null;
          motivo?: string | null;
          origen?: string;
          usuario_id?: string | null;
          created_at?: string;
          observacion?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'reprogramaciones_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reprogramaciones_requerimiento_id_fkey';
            columns: ['requerimiento_id'];
            isOneToOne: false;
            referencedRelation: 'requerimientos';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reprogramaciones_usuario_id_fkey';
            columns: ['usuario_id'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
        ];
      };
      requerimiento_responsables: {
        Row: {
          id: number;
          tenant_id: string;
          requerimiento_id: string;
          usuario_id: string;
          desde: string;
          hasta: string | null;
          motivo: string | null;
        };
        Insert: {
          id?: number;
          tenant_id: string;
          requerimiento_id: string;
          usuario_id: string;
          desde?: string;
          hasta?: string | null;
          motivo?: string | null;
        };
        Update: {
          id?: number;
          tenant_id?: string;
          requerimiento_id?: string;
          usuario_id?: string;
          desde?: string;
          hasta?: string | null;
          motivo?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'requerimiento_responsables_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'requerimiento_responsables_requerimiento_id_fkey';
            columns: ['requerimiento_id'];
            isOneToOne: false;
            referencedRelation: 'requerimientos';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'requerimiento_responsables_usuario_id_fkey';
            columns: ['usuario_id'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
        ];
      };
      requerimientos: {
        Row: {
          id: string;
          tenant_id: string;
          cliente_id: string;
          proyecto_id: string | null;
          bloque_nombre: string | null;
          plantilla_tarea_id: string | null;
          titulo_interno: string;
          etiqueta_cliente: string | null;
          visible_cliente: boolean;
          tipo_trabajo: string;
          estado_operativo:
            'backlog' | 'priorizado' | 'en_ejecucion' | 'en_revision' | 'reprogramado' | 'bloqueado' | 'completado' | 'cancelado';
          estado_aprobacion: 'no_aplica' | 'pendiente_interno' | 'pendiente_cliente' | 'aprobado' | 'rechazado';
          prioridad: 'alta' | 'media' | 'baja';
          peso: number;
          fecha_pedido: string | null;
          fecha_entrega: string | null;
          fecha_entrega_original: string | null;
          veces_reprogramado: number;
          owner_agencia: string[];
          owner_cliente: string[] | null;
          piezas: number;
          brief_url: string | null;
          entregable_urls: string[] | null;
          basecamp_todo_id: number | null;
          basecamp_todolist_id: number | null;
          basecamp_url: string | null;
          ultima_actualizacion: string;
          completado_at: string | null;
          created_at: string;
          updated_at: string;
          created_by: string | null;
          updated_by: string | null;
          deleted_at: string | null;
          tipo_pieza_id: string | null;
          veces_reproceso: number;
          planificacion: string;
          daily_fecha: string | null;
          clase: string;
          proactiva: boolean;
          primera_respuesta_at: string | null;
          responsables_cierre: string[] | null;
          heredada: boolean;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          cliente_id: string;
          proyecto_id?: string | null;
          bloque_nombre?: string | null;
          plantilla_tarea_id?: string | null;
          titulo_interno: string;
          etiqueta_cliente?: string | null;
          visible_cliente?: boolean;
          tipo_trabajo?: string;
          estado_operativo?:
            'backlog' | 'priorizado' | 'en_ejecucion' | 'en_revision' | 'reprogramado' | 'bloqueado' | 'completado' | 'cancelado';
          estado_aprobacion?: 'no_aplica' | 'pendiente_interno' | 'pendiente_cliente' | 'aprobado' | 'rechazado';
          prioridad?: 'alta' | 'media' | 'baja';
          peso?: number;
          fecha_pedido?: string | null;
          fecha_entrega?: string | null;
          fecha_entrega_original?: string | null;
          veces_reprogramado?: number;
          owner_agencia?: string[];
          owner_cliente?: string[] | null;
          piezas?: number;
          brief_url?: string | null;
          entregable_urls?: string[] | null;
          basecamp_todo_id?: number | null;
          basecamp_todolist_id?: number | null;
          basecamp_url?: string | null;
          ultima_actualizacion?: string;
          completado_at?: string | null;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
          updated_by?: string | null;
          deleted_at?: string | null;
          tipo_pieza_id?: string | null;
          veces_reproceso?: number;
          planificacion?: string;
          daily_fecha?: string | null;
          clase?: string;
          proactiva?: boolean;
          primera_respuesta_at?: string | null;
          responsables_cierre?: string[] | null;
          heredada?: boolean;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          cliente_id?: string;
          proyecto_id?: string | null;
          bloque_nombre?: string | null;
          plantilla_tarea_id?: string | null;
          titulo_interno?: string;
          etiqueta_cliente?: string | null;
          visible_cliente?: boolean;
          tipo_trabajo?: string;
          estado_operativo?:
            'backlog' | 'priorizado' | 'en_ejecucion' | 'en_revision' | 'reprogramado' | 'bloqueado' | 'completado' | 'cancelado';
          estado_aprobacion?: 'no_aplica' | 'pendiente_interno' | 'pendiente_cliente' | 'aprobado' | 'rechazado';
          prioridad?: 'alta' | 'media' | 'baja';
          peso?: number;
          fecha_pedido?: string | null;
          fecha_entrega?: string | null;
          fecha_entrega_original?: string | null;
          veces_reprogramado?: number;
          owner_agencia?: string[];
          owner_cliente?: string[] | null;
          piezas?: number;
          brief_url?: string | null;
          entregable_urls?: string[] | null;
          basecamp_todo_id?: number | null;
          basecamp_todolist_id?: number | null;
          basecamp_url?: string | null;
          ultima_actualizacion?: string;
          completado_at?: string | null;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
          updated_by?: string | null;
          deleted_at?: string | null;
          tipo_pieza_id?: string | null;
          veces_reproceso?: number;
          planificacion?: string;
          daily_fecha?: string | null;
          clase?: string;
          proactiva?: boolean;
          primera_respuesta_at?: string | null;
          responsables_cierre?: string[] | null;
          heredada?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'requerimientos_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'requerimientos_cliente_id_fkey';
            columns: ['cliente_id'];
            isOneToOne: false;
            referencedRelation: 'clientes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'requerimientos_proyecto_id_fkey';
            columns: ['proyecto_id'];
            isOneToOne: false;
            referencedRelation: 'proyectos';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'requerimientos_plantilla_tarea_id_fkey';
            columns: ['plantilla_tarea_id'];
            isOneToOne: false;
            referencedRelation: 'plantilla_tareas';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'requerimientos_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'requerimientos_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'requerimientos_tipo_pieza_id_fkey';
            columns: ['tipo_pieza_id'];
            isOneToOne: false;
            referencedRelation: 'tipos_pieza';
            referencedColumns: ['id'];
          },
        ];
      };
      semanas: {
        Row: {
          id: string;
          tenant_id: string;
          anio: number;
          numero_iso: number;
          fecha_inicio: string;
          fecha_fin: string;
          plan_publicado_at: string | null;
          acta_publicada_at: string | null;
          created_at: string;
          plan_publicado_por_mesa: Json;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          anio: number;
          numero_iso: number;
          fecha_inicio: string;
          fecha_fin: string;
          plan_publicado_at?: string | null;
          acta_publicada_at?: string | null;
          created_at?: string;
          plan_publicado_por_mesa?: Json;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          anio?: number;
          numero_iso?: number;
          fecha_inicio?: string;
          fecha_fin?: string;
          plan_publicado_at?: string | null;
          acta_publicada_at?: string | null;
          created_at?: string;
          plan_publicado_por_mesa?: Json;
        };
        Relationships: [
          {
            foreignKeyName: 'semanas_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      senales: {
        Row: {
          id: string;
          tenant_id: string;
          semana_id: string;
          tipo: string;
          severidad: string;
          entidad_tipo: string;
          entidad_id: string;
          titulo: string;
          detalle: Json;
          atendida: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          semana_id: string;
          tipo: string;
          severidad: string;
          entidad_tipo: string;
          entidad_id: string;
          titulo: string;
          detalle?: Json;
          atendida?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          semana_id?: string;
          tipo?: string;
          severidad?: string;
          entidad_tipo?: string;
          entidad_id?: string;
          titulo?: string;
          detalle?: Json;
          atendida?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'senales_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'senales_semana_id_fkey';
            columns: ['semana_id'];
            isOneToOne: false;
            referencedRelation: 'semanas';
            referencedColumns: ['id'];
          },
        ];
      };
      tenants: {
        Row: {
          id: string;
          nombre: string;
          slug: string;
          config: Json;
          activo: boolean;
          created_at: string;
          updated_at: string;
          dominios_auto: string[];
        };
        Insert: {
          id?: string;
          nombre: string;
          slug: string;
          config?: Json;
          activo?: boolean;
          created_at?: string;
          updated_at?: string;
          dominios_auto?: string[];
        };
        Update: {
          id?: string;
          nombre?: string;
          slug?: string;
          config?: Json;
          activo?: boolean;
          created_at?: string;
          updated_at?: string;
          dominios_auto?: string[];
        };
        Relationships: [];
      };
      tipos_pieza: {
        Row: {
          id: string;
          tenant_id: string;
          nombre: string;
          slug: string;
          esfuerzo: number;
          pasos: Json;
          activo: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          nombre: string;
          slug: string;
          esfuerzo?: number;
          pasos?: Json;
          activo?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          nombre?: string;
          slug?: string;
          esfuerzo?: number;
          pasos?: Json;
          activo?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tipos_pieza_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      usuarios: {
        Row: {
          id: string;
          tenant_id: string;
          nombre: string;
          email: string;
          rol: 'admin' | 'gerencia' | 'operaciones' | 'ejecutiva' | 'lider' | 'colaborador';
          avatar_url: string | null;
          basecamp_user_id: number | null;
          capacidad_semanal: number;
          activo: boolean;
          created_at: string;
          updated_at: string;
          area: string | null;
          fecha_salida: string | null;
          motivo_salida: string | null;
        };
        Insert: {
          id: string;
          tenant_id: string;
          nombre: string;
          email: string;
          rol?: 'admin' | 'gerencia' | 'operaciones' | 'ejecutiva' | 'lider' | 'colaborador';
          avatar_url?: string | null;
          basecamp_user_id?: number | null;
          capacidad_semanal?: number;
          activo?: boolean;
          created_at?: string;
          updated_at?: string;
          area?: string | null;
          fecha_salida?: string | null;
          motivo_salida?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          nombre?: string;
          email?: string;
          rol?: 'admin' | 'gerencia' | 'operaciones' | 'ejecutiva' | 'lider' | 'colaborador';
          avatar_url?: string | null;
          basecamp_user_id?: number | null;
          capacidad_semanal?: number;
          activo?: boolean;
          created_at?: string;
          updated_at?: string;
          area?: string | null;
          fecha_salida?: string | null;
          motivo_salida?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'usuarios_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      v_requerimientos_metricas: {
        Row: {
          id: string | null;
          tenant_id: string | null;
          cliente_id: string | null;
          proyecto_id: string | null;
          bloque_nombre: string | null;
          plantilla_tarea_id: string | null;
          titulo_interno: string | null;
          etiqueta_cliente: string | null;
          visible_cliente: boolean | null;
          tipo_trabajo: string | null;
          estado_operativo:
            'backlog' | 'priorizado' | 'en_ejecucion' | 'en_revision' | 'reprogramado' | 'bloqueado' | 'completado' | 'cancelado' | null;
          estado_aprobacion: 'no_aplica' | 'pendiente_interno' | 'pendiente_cliente' | 'aprobado' | 'rechazado' | null;
          prioridad: 'alta' | 'media' | 'baja' | null;
          peso: number | null;
          fecha_pedido: string | null;
          fecha_entrega: string | null;
          fecha_entrega_original: string | null;
          veces_reprogramado: number | null;
          owner_agencia: string[] | null;
          owner_cliente: string[] | null;
          piezas: number | null;
          brief_url: string | null;
          entregable_urls: string[] | null;
          basecamp_todo_id: number | null;
          basecamp_todolist_id: number | null;
          basecamp_url: string | null;
          ultima_actualizacion: string | null;
          completado_at: string | null;
          created_at: string | null;
          updated_at: string | null;
          created_by: string | null;
          updated_by: string | null;
          deleted_at: string | null;
          tipo_pieza_id: string | null;
          veces_reproceso: number | null;
          planificacion: string | null;
          daily_fecha: string | null;
          clase: string | null;
          proactiva: boolean | null;
          primera_respuesta_at: string | null;
          responsables_cierre: string[] | null;
          heredada: boolean | null;
          dias_atraso: number | null;
          dias_sin_movimiento: number | null;
          peso_completado: number | null;
        };
        Insert: {
          id?: string | null;
          tenant_id?: string | null;
          cliente_id?: string | null;
          proyecto_id?: string | null;
          bloque_nombre?: string | null;
          plantilla_tarea_id?: string | null;
          titulo_interno?: string | null;
          etiqueta_cliente?: string | null;
          visible_cliente?: boolean | null;
          tipo_trabajo?: string | null;
          estado_operativo?:
            'backlog' | 'priorizado' | 'en_ejecucion' | 'en_revision' | 'reprogramado' | 'bloqueado' | 'completado' | 'cancelado' | null;
          estado_aprobacion?: 'no_aplica' | 'pendiente_interno' | 'pendiente_cliente' | 'aprobado' | 'rechazado' | null;
          prioridad?: 'alta' | 'media' | 'baja' | null;
          peso?: number | null;
          fecha_pedido?: string | null;
          fecha_entrega?: string | null;
          fecha_entrega_original?: string | null;
          veces_reprogramado?: number | null;
          owner_agencia?: string[] | null;
          owner_cliente?: string[] | null;
          piezas?: number | null;
          brief_url?: string | null;
          entregable_urls?: string[] | null;
          basecamp_todo_id?: number | null;
          basecamp_todolist_id?: number | null;
          basecamp_url?: string | null;
          ultima_actualizacion?: string | null;
          completado_at?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
          created_by?: string | null;
          updated_by?: string | null;
          deleted_at?: string | null;
          tipo_pieza_id?: string | null;
          veces_reproceso?: number | null;
          planificacion?: string | null;
          daily_fecha?: string | null;
          clase?: string | null;
          proactiva?: boolean | null;
          primera_respuesta_at?: string | null;
          responsables_cierre?: string[] | null;
          heredada?: boolean | null;
          dias_atraso?: number | null;
          dias_sin_movimiento?: number | null;
          peso_completado?: number | null;
        };
        Update: {
          id?: string | null;
          tenant_id?: string | null;
          cliente_id?: string | null;
          proyecto_id?: string | null;
          bloque_nombre?: string | null;
          plantilla_tarea_id?: string | null;
          titulo_interno?: string | null;
          etiqueta_cliente?: string | null;
          visible_cliente?: boolean | null;
          tipo_trabajo?: string | null;
          estado_operativo?:
            'backlog' | 'priorizado' | 'en_ejecucion' | 'en_revision' | 'reprogramado' | 'bloqueado' | 'completado' | 'cancelado' | null;
          estado_aprobacion?: 'no_aplica' | 'pendiente_interno' | 'pendiente_cliente' | 'aprobado' | 'rechazado' | null;
          prioridad?: 'alta' | 'media' | 'baja' | null;
          peso?: number | null;
          fecha_pedido?: string | null;
          fecha_entrega?: string | null;
          fecha_entrega_original?: string | null;
          veces_reprogramado?: number | null;
          owner_agencia?: string[] | null;
          owner_cliente?: string[] | null;
          piezas?: number | null;
          brief_url?: string | null;
          entregable_urls?: string[] | null;
          basecamp_todo_id?: number | null;
          basecamp_todolist_id?: number | null;
          basecamp_url?: string | null;
          ultima_actualizacion?: string | null;
          completado_at?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
          created_by?: string | null;
          updated_by?: string | null;
          deleted_at?: string | null;
          tipo_pieza_id?: string | null;
          veces_reproceso?: number | null;
          planificacion?: string | null;
          daily_fecha?: string | null;
          clase?: string | null;
          proactiva?: boolean | null;
          primera_respuesta_at?: string | null;
          responsables_cierre?: string[] | null;
          heredada?: boolean | null;
          dias_atraso?: number | null;
          dias_sin_movimiento?: number | null;
          peso_completado?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'v_requerimientos_metricas_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'v_requerimientos_metricas_cliente_id_fkey';
            columns: ['cliente_id'];
            isOneToOne: false;
            referencedRelation: 'clientes';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'v_requerimientos_metricas_proyecto_id_fkey';
            columns: ['proyecto_id'];
            isOneToOne: false;
            referencedRelation: 'proyectos';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'v_requerimientos_metricas_plantilla_tarea_id_fkey';
            columns: ['plantilla_tarea_id'];
            isOneToOne: false;
            referencedRelation: 'plantilla_tareas';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'v_requerimientos_metricas_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'v_requerimientos_metricas_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'usuarios';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'v_requerimientos_metricas_tipo_pieza_id_fkey';
            columns: ['tipo_pieza_id'];
            isOneToOne: false;
            referencedRelation: 'tipos_pieza';
            referencedColumns: ['id'];
          },
        ];
      };
      weekly_snapshots: {
        Row: {
          id: string;
          tenant_id: string;
          mesa_id: string;
          semana_id: string;
          fecha_inicio: string;
          fecha_fin: string;
          metricas: Json;
          origen: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          mesa_id: string;
          semana_id: string;
          fecha_inicio: string;
          fecha_fin: string;
          metricas?: Json;
          origen: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          mesa_id?: string;
          semana_id?: string;
          fecha_inicio?: string;
          fecha_fin?: string;
          metricas?: Json;
          origen?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'weekly_snapshots_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'weekly_snapshots_mesa_id_fkey';
            columns: ['mesa_id'];
            isOneToOne: false;
            referencedRelation: 'mesas';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'weekly_snapshots_semana_id_fkey';
            columns: ['semana_id'];
            isOneToOne: false;
            referencedRelation: 'semanas';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      v_proyectos_avance: {
        Row: {
          proyecto_id: string | null;
          tenant_id: string | null;
          cliente_id: string | null;
          peso_total: number | null;
          peso_completado: number | null;
          avance: number | null;
          atrasados: number | null;
          esperando_cliente: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'v_proyectos_avance_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'v_proyectos_avance_cliente_id_fkey';
            columns: ['cliente_id'];
            isOneToOne: false;
            referencedRelation: 'clientes';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Functions: {
      _insertar_fila: {
        Args: { p_fila: Json | null; p_tabla: string | null };
        Returns: Json;
      };
      auth_es_admin: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      auth_es_gestion: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      auth_rol: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      auth_tenant_id: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      crear_lote: {
        Args: { p_proyectos: Json | null; p_requerimientos: Json | null };
        Returns: Json;
      };
      ensure_semana: {
        Args: { p_fecha: string | null; p_tenant: string | null };
        Returns: Json;
      };
      limite_estado: {
        Args: { p_clave: string | null; p_max: number | null; p_ventana_seg: number | null };
        Returns: Json;
      };
      limite_sumar: {
        Args: { p_clave: string | null; p_max: number | null; p_ventana_seg: number | null };
        Returns: Json;
      };
      limites_limpiar: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      proyectos_recalcular_estado: {
        Args: { p_proyecto: string | null };
        Returns: Json;
      };
      salida_colaborador: {
        Args: {
          p_actor: string | null;
          p_fecha: string | null;
          p_motivo: string | null;
          p_plan: Json | null;
          p_tenant: string | null;
          p_usuario: string | null;
        };
        Returns: Json;
      };
    };
    Enums: {
      estado_aprobacion: 'no_aplica' | 'pendiente_interno' | 'pendiente_cliente' | 'aprobado' | 'rechazado';
      estado_operativo:
        'backlog' | 'priorizado' | 'en_ejecucion' | 'en_revision' | 'reprogramado' | 'bloqueado' | 'completado' | 'cancelado';
      prioridad_t: 'alta' | 'media' | 'baja';
      rol_t: 'admin' | 'gerencia' | 'operaciones' | 'ejecutiva' | 'lider' | 'colaborador';
      sync_estado_t: 'pendiente' | 'ok' | 'incompleto';
      tipo_plantilla_t: 'campana' | 'lanzamiento' | 'fee_mensual' | 'pieza_suelta' | 'trade';
    };
    CompositeTypes: Record<string, never>;
  };
};
