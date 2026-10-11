/**
 * Tools de lectura. Ninguna devuelve texto de Basecamp: nunca entra a la base.
 */
import { z } from 'zod';
import { listBacklog } from '../../db/requerimientos';
import { getProyectoDetalle, listProyectos } from '../../db/proyectos';
import { listClientes } from '../../db/clientes';
import { listPlantillas, getPlantillaArbol } from '../../db/plantillas';
import { listUsuarios } from '../../db/usuarios';
import { resolverMesa, alcanceMesa } from '../../db/mesas';
import { listTiposPieza } from '../../db/tipos_pieza';
import { ensureSemana, getSemana, listSenales, listAcuerdosAbiertos } from '../../db/semanas';
import { sanitizeForClient } from '../../visibility';
import { capacidadSemana, recalcularSenales } from '../../rituals/service';
import { temaAgenda } from '../../rituals/signals';
import { buildDashboard } from '../../dashboard';
import { resumenHoras } from '../../horas';
import { narrarWeekly } from '../../ia/weekly';
import { hoyLocal } from '@backio/shared';
import { type Herramientas, ok, fail, tiene, esScopeCliente, reqInterno, mapas, resolverCliente } from '../comun';

export function registrarLectura({ server, auth, ctx, guard }: Herramientas): void {
  server.registerTool(
    'list_backlog',
    {
      description: 'Requerimientos filtrados del backlog operativo. Solo datos de BackIO; nunca comentarios de Basecamp.',
      inputSchema: {
        cliente: z.string().optional().describe('id, slug o parte del nombre del cliente'),
        owner: z.string().optional().describe('nombre o id de la persona responsable'),
        estado: z
          .enum(['backlog', 'priorizado', 'en_ejecucion', 'en_revision', 'reprogramado', 'bloqueado', 'completado', 'cancelado'])
          .optional(),
        semana: z.enum(['actual']).optional().describe('"actual" limita a requerimientos con entrega en la semana ISO en curso'),
        mesa: z.string().optional().describe('nombre o slug de la mesa (Orión, Omega)'),
        min_dias_atraso: z.number().int().min(0).optional(),
        solo_activos: z.boolean().default(true),
        limite: z.number().int().min(1).max(200).default(50),
      },
    },
    (args) =>
      guard(['read:backlog'], async () => {
        if (esScopeCliente(auth)) return fail('Esta tool no está disponible con scope cliente');
        const m = await mapas(ctx);
        const cliente = await resolverCliente(ctx, args.cliente);
        if (args.cliente && !cliente) return fail(`Cliente "${args.cliente}" no encontrado`);
        const owner = args.owner
          ? m.usuarios.find((u) => u.id === args.owner || u.nombre.toLowerCase().includes(args.owner!.toLowerCase()))
          : null;
        let desde: string | undefined, hasta: string | undefined;
        if (args.semana === 'actual') {
          const s = await ensureSemana(ctx, hoyLocal());
          desde = s.fecha_inicio;
          hasta = s.fecha_fin;
        }
        let alcance;
        if (args.mesa) {
          const m2 = await resolverMesa(ctx, args.mesa);
          if (!m2) return fail(`Mesa "${args.mesa}" no encontrada`);
          alcance = await alcanceMesa(ctx, m2.id);
        }
        const items = await listBacklog(ctx, {
          cliente_id: cliente?.id,
          owner: owner?.id,
          estado: args.estado,
          min_dias_atraso: args.min_dias_atraso,
          solo_activos: args.solo_activos,
          desde,
          hasta,
          mesa: alcance,
        });
        return ok({ total: items.length, items: items.slice(0, args.limite).map((r) => reqInterno(r, m.nombres, m.clientes)) });
      })(),
  );

  server.registerTool(
    'get_project_status',
    {
      description: 'Avance ponderado, hitos y bloqueos de un proyecto. Con scope cliente devuelve solo la vista sanitizada.',
      inputSchema: { proyecto_id: z.string().uuid() },
    },
    ({ proyecto_id }) =>
      guard(['read:proyectos'], async () => {
        const det = await getProyectoDetalle(ctx, proyecto_id);
        if (!det) return fail('Proyecto no encontrado');
        if (esScopeCliente(auth)) {
          // La key de un cliente solo ve proyectos de ese cliente; una key sin cliente no ve ninguno (S11).
          if (!auth.clienteId || det.cliente_id !== auth.clienteId) return fail('Proyecto no encontrado');
          return ok(sanitizeForClient(det, det.requerimientos));
        }
        const m = await mapas(ctx);
        const { requerimientos, ...p } = det;
        return ok({
          proyecto: {
            id: p.id,
            nombre: p.nombre,
            cliente: p.cliente_nombre,
            estado: p.estado,
            fecha_inicio: p.fecha_inicio,
            fecha_entrega: p.fecha_entrega,
            avance_interno: p.avance,
            portal_activo: p.portal_activo,
            sync_basecamp: p.sync_estado,
          },
          vista_cliente: sanitizeForClient(det, requerimientos),
          requerimientos: requerimientos.map((r) => reqInterno(r, m.nombres, m.clientes)),
        });
      })(),
  );

  server.registerTool(
    'get_weekly_signals',
    {
      description:
        'Señales del motor del weekly ordenadas por severidad, con el tema de agenda que disparan. Por defecto la semana actual.',
      inputSchema: {
        semana_id: z.string().uuid().optional(),
        recalcular: z.boolean().default(false).describe('Recalcula las señales antes de devolverlas'),
      },
    },
    ({ semana_id, recalcular }) =>
      guard(['read:senales'], async () => {
        if (esScopeCliente(auth)) return fail('No disponible con scope cliente');
        const semana = semana_id ? await getSemana(ctx, semana_id) : await ensureSemana(ctx, hoyLocal());
        if (!semana) return fail('Semana no encontrada');
        const senales =
          recalcular && tiene(auth, 'write:actas') ? await recalcularSenales(ctx, semana.id) : await listSenales(ctx, semana.id);
        const abiertos = await listAcuerdosAbiertos(ctx);
        return ok({
          semana: { id: semana.id, numero_iso: semana.numero_iso, inicio: semana.fecha_inicio, fin: semana.fecha_fin },
          total: senales.length,
          senales: senales.map((s) => ({
            tipo: s.tipo,
            severidad: s.severidad,
            titulo: s.titulo,
            tema_agenda: temaAgenda(s.tipo),
            atendida: s.atendida,
            detalle: s.detalle,
          })),
          acuerdos_abiertos: abiertos.length,
        });
      })(),
  );

  server.registerTool(
    'get_capacity',
    {
      description: 'Carga por persona en la semana (tareas asignadas vs capacidad declarada en horas).',
      inputSchema: { semana_id: z.string().uuid().optional() },
    },
    ({ semana_id }) =>
      guard(['read:capacidad'], async () => {
        if (esScopeCliente(auth)) return fail('No disponible con scope cliente');
        const semana = semana_id ? await getSemana(ctx, semana_id) : await ensureSemana(ctx, hoyLocal());
        if (!semana) return fail('Semana no encontrada');
        return ok({ semana: { id: semana.id, numero_iso: semana.numero_iso }, personas: await capacidadSemana(ctx, semana.id) });
      })(),
  );

  server.registerTool(
    'get_client_health',
    {
      description: 'Salud de una cuenta: proyectos activos, atrasos, días sin movimiento, esperas del cliente.',
      inputSchema: { cliente: z.string().describe('id, slug o parte del nombre') },
    },
    ({ cliente }) =>
      guard(['read:proyectos'], async () => {
        // Vista interna (atrasos, avance interno, títulos de tareas ocultas) y sin vínculo key→cliente: no para scope cliente.
        if (esScopeCliente(auth)) return fail('No disponible con scope cliente');
        const c = await resolverCliente(ctx, cliente);
        if (!c) return fail(`Cliente "${cliente}" no encontrado`);
        const [proyectos, activos] = await Promise.all([
          listProyectos(ctx, { cliente_id: c.id }),
          listBacklog(ctx, { cliente_id: c.id, solo_activos: true }),
        ]);
        const enCurso = proyectos.filter((p) => !['completado', 'cancelado'].includes(p.estado));
        const salida = {
          cliente: c.nombre,
          cliente_id: c.id,
          activo: c.activo,
          proyectos_activos: enCurso.map((p) => ({
            id: p.id,
            nombre: p.nombre,
            avance: p.avance,
            entrega: p.fecha_entrega,
            estado: p.estado,
          })),
          requerimientos_activos: activos.length,
          atrasados: activos.filter((r) => r.dias_atraso > 0).length,
          dias_sin_movimiento_min: activos.length ? Math.min(...activos.map((r) => r.dias_sin_movimiento)) : null,
          esperando_cliente: activos
            .filter((r) => r.estado_aprobacion === 'pendiente_cliente')
            .map((r) => ({ titulo: r.titulo_interno, dias: r.dias_sin_movimiento })),
        };
        return ok(salida);
      })(),
  );

  server.registerTool(
    'search_requirements',
    {
      description: 'Búsqueda de texto en títulos internos de requerimientos.',
      inputSchema: { query: z.string().min(2), limite: z.number().int().min(1).max(100).default(30) },
    },
    ({ query, limite }) =>
      guard(['read:backlog'], async () => {
        if (esScopeCliente(auth)) return fail('No disponible con scope cliente');
        const m = await mapas(ctx);
        const items = await listBacklog(ctx, { query });
        return ok({ total: items.length, items: items.slice(0, limite).map((r) => reqInterno(r, m.nombres, m.clientes)) });
      })(),
  );

  server.registerTool(
    'list_clients_and_templates',
    {
      description:
        'Catálogo: clientes activos, plantillas disponibles (con sus bloques) y personas del equipo. Útil antes de planificar un proyecto.',
      inputSchema: {},
    },
    () =>
      guard(['read:proyectos'], async () => {
        if (esScopeCliente(auth)) return fail('No disponible con scope cliente');
        const [clientes, plantillas, usuarios] = await Promise.all([listClientes(ctx), listPlantillas(ctx), listUsuarios(ctx)]);
        const arboles = await Promise.all(plantillas.map((p) => getPlantillaArbol(ctx, p.id)));
        return ok({
          clientes: clientes.map((c) => ({ id: c.id, nombre: c.nombre, slug: c.slug, basecamp_configurado: !!c.basecamp_project_id })),
          plantillas: arboles.filter(Boolean).map((p) => ({
            id: p!.id,
            nombre: p!.nombre,
            tipo: p!.tipo,
            bloques: p!.bloques.map((b) => ({ id: b.id, nombre: b.nombre, peso: b.peso, opcional: b.opcional, tareas: b.tareas.length })),
          })),
          tipos_pieza: (await listTiposPieza(ctx)).map((t) => ({
            id: t.id,
            slug: t.slug,
            nombre: t.nombre,
            esfuerzo: t.esfuerzo,
            pasos: t.pasos.map((p) => p.titulo),
          })),
          equipo: usuarios.map((u) => ({ id: u.id, nombre: u.nombre, rol: u.rol, capacidad_semanal: u.capacidad_semanal })),
        });
      })(),
  );

  server.registerTool(
    'get_dashboard',
    {
      description:
        'KPIs de la agencia o de una mesa: activos, atrasados, sin movimiento, esperando cliente, salud por cliente, carga por persona, arrastre y serie de 8 semanas.',
      inputSchema: { mesa: z.string().optional().describe('nombre o slug de la mesa; vacío = toda la agencia') },
    },
    ({ mesa }) =>
      guard(['read:backlog', 'read:proyectos'], async () => {
        if (esScopeCliente(auth)) return fail('No disponible con scope cliente');
        let mesaId: string | null = null;
        if (mesa) {
          const m = await resolverMesa(ctx, mesa);
          if (!m) return fail(`Mesa "${mesa}" no encontrada`);
          mesaId = m.id;
        }
        return ok(await buildDashboard(ctx, mesaId));
      })(),
  );

  server.registerTool(
    'get_hours',
    {
      description:
        'Horas registradas en Basecamp (timesheet) por cliente, persona y proyecto en los últimos N días. Solo números; nunca la descripción de las entradas.',
      inputSchema: { dias: z.number().int().min(1).max(365).default(30) },
    },
    ({ dias }) =>
      guard(['read:backlog'], async () => {
        if (esScopeCliente(auth)) return fail('No disponible con scope cliente');
        const m = await mapas(ctx);
        const r = await resumenHoras(ctx, new Date(Date.now() - dias * 86_400_000).toISOString());
        return ok({
          dias,
          total: r.total,
          por_cliente: Object.fromEntries(Object.entries(r.por_cliente).map(([k, v]) => [m.clientes.get(k) ?? k, v])),
          por_persona: Object.fromEntries(Object.entries(r.por_usuario).map(([k, v]) => [m.nombres.get(k) ?? k, v])),
        });
      })(),
  );

  server.registerTool(
    'get_weekly_narrative',
    {
      description:
        'Status semanal narrado por la IA de BackIO + agenda agrupada por causa con una pregunta de decisión por grupo. Solo lectura; se alimenta de datos estructurados (nunca texto de Basecamp).',
      inputSchema: { mesa: z.string().optional().describe('id, slug o nombre de la mesa; vacío = toda la agencia') },
    },
    ({ mesa }) =>
      guard(['read:senales'], async () => {
        if (esScopeCliente(auth)) return fail('No disponible con scope cliente');
        const m = mesa ? await resolverMesa(ctx, mesa) : null;
        if (mesa && !m) return fail(`Mesa no encontrada: ${mesa}`);
        const semana = await ensureSemana(ctx, hoyLocal());
        return ok(await narrarWeekly(ctx, semana.id, m?.id ?? null));
      })(),
  );
}
