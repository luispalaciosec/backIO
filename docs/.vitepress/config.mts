import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

// Sitio de documentación de BackIO. Los archivos .md de esta carpeta son la fuente: se editan aquí mismo y el sitio
// solo los presenta. Correr con `pnpm --filter @backio/docs dev`.
export default withMermaid(
  defineConfig({
    lang: 'es-EC',
    title: 'BackIO',
    description: 'Documentación de BackIO · Geeks Ecuador',
    // Se publica dentro del frontend en backio.vercel.app/docs (archivos estáticos de Next): rutas con .html.
    base: '/docs/',
    cleanUrls: false,
    lastUpdated: true,
    // README.md es el índice para quien navega el repo en GitHub; el sitio tiene su propia portada.
    srcExclude: ['README.md', 'manual/**'],
    head: [['link', { rel: 'icon', href: '/docs/backio-icon.svg' }], ['meta', { name: 'robots', content: 'noindex, nofollow' }]],
    themeConfig: {
      logo: '/backio-icon.svg',
      nav: [
        { text: 'Empezar', link: '/empezar' },
        { text: 'Cómo funciona', link: '/00-arquitectura' },
        { text: 'Operación', link: '/operacion' },
        { text: 'Referencia', link: '/17-arquitectura-tecnica' },
      ],
      sidebar: [
        { text: 'Inicio', items: [{ text: 'Por dónde empezar', link: '/empezar' }, { text: 'Glosario', link: '/glosario' }] },
        {
          text: 'Cómo funciona BackIO',
          items: [
            { text: 'Arquitectura y las cinco reglas', link: '/00-arquitectura' },
            { text: 'Qué ve el cliente (visibilidad)', link: '/02-visibilidad' },
            { text: 'Integración con Basecamp', link: '/04-basecamp' },
            { text: 'Rituales: weekly, daily, señales', link: '/05-rituales' },
            { text: 'Cumplimiento: reprogramaciones y reprocesos', link: '/16-cumplimiento' },
            { text: 'KPIs por persona y equipo', link: '/19-kpis' },
            { text: 'Cuando alguien se va', link: '/20-salida' },
            { text: 'Clientes: ejecutiva y ficha', link: '/21-clientes' },
            { text: 'Builder de proyectos', link: '/03-builder' },
            { text: 'Portal del cliente', link: '/06-portal-cliente' },
            { text: 'Capa de IA', link: '/15-ia' },
            { text: 'Integración con PrometIO', link: '/08-prometio' },
          ],
        },
        {
          text: 'Operación',
          items: [
            { text: 'Operar BackIO: cuando algo falla', link: '/operacion' },
            { text: 'Levantar el proyecto en local', link: '/11-setup' },
            { text: 'Despliegue', link: '/12-despliegue' },
            { text: 'Seguridad', link: '/18-seguridad' },
          ],
        },
        {
          text: 'Referencia técnica',
          items: [
            { text: 'Arquitectura técnica', link: '/17-arquitectura-tecnica' },
            { text: 'Modelo de datos', link: '/01-modelo-datos' },
            { text: 'Esquema de la base (generado)', link: '/esquema' },
            { text: 'API REST y agentes (MCP)', link: '/07-api-mcp' },
            { text: 'Conectar un agente al MCP', link: '/13-mcp' },
            { text: 'Referencia de la API (generada)', link: '/referencia-api' },
          ],
        },
        { text: 'Decisiones', items: [{ text: 'Registro de decisiones', link: '/decisiones' }] },
        {
          text: 'Historia',
          collapsed: true,
          items: [
            { text: 'Plan de fases', link: '/09-fases' },
            { text: 'Plan v2 (sep–oct 2026)', link: '/14-plan-v2' },
            { text: 'CoreIO (no se construyó)', link: '/10-core' },
            { text: 'Endurecimiento tras la auditoría del 10/10', link: '/endurecimiento' },
          ],
        },
      ],
      outline: { level: [2, 3], label: 'En esta página' },
      docFooter: { prev: 'Anterior', next: 'Siguiente' },
      lastUpdated: { text: 'Actualizado' },
      returnToTopLabel: 'Volver arriba',
      sidebarMenuLabel: 'Menú',
      darkModeSwitchLabel: 'Tema',
      search: {
        provider: 'local',
        options: {
          translations: {
            button: { buttonText: 'Buscar', buttonAriaLabel: 'Buscar' },
            modal: {
              noResultsText: 'Sin resultados para',
              resetButtonTitle: 'Limpiar',
              footer: { selectText: 'abrir', navigateText: 'moverse', closeText: 'cerrar' },
            },
          },
        },
      },
      notFound: { title: 'Página no encontrada', quote: 'Puede que se haya movido. Usa el buscador o vuelve al inicio.', linkText: 'Ir al inicio' },
    },
    mermaid: { theme: 'neutral' },
    // Con pnpm, Vite necesita preempaquetar mermaid para servirlo en desarrollo (el build no lo necesita).
    vite: { optimizeDeps: { include: ['mermaid'] } },
  }),
);
