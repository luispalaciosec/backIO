# Documentación de BackIO

El orden de lectura recomendado está en `CLAUDE.md`. Este índice dice qué responde cada documento.

| Documento | Responde |
|---|---|
| [00-arquitectura](00-arquitectura.md) | Qué es BackIO, cómo encaja con Basecamp, PrometIO y DatIO, y las cinco reglas |
| [01-modelo-datos](01-modelo-datos.md) | Tablas, columnas y políticas RLS |
| [02-visibilidad](02-visibilidad.md) | Qué ve el cliente y qué no. Léelo antes de tocar el portal o la sincronización |
| [03-builder](03-builder.md) | Cómo se crea un proyecto desde una plantilla |
| [04-basecamp](04-basecamp.md) | Qué se sincroniza con Basecamp y en qué sentido; incidentes |
| [05-rituales](05-rituales.md) | Weekly, daily, señales y evolutivo |
| [06-portal-cliente](06-portal-cliente.md) | El portal público del cliente |
| [07-api-mcp](07-api-mcp.md) · [13-mcp](13-mcp.md) | API REST, OAuth y tools MCP para agentes |
| [08-prometio](08-prometio.md) | Integración con el CRM |
| [09-fases](09-fases.md) · [14-plan-v2](14-plan-v2.md) | Plan de ejecución |
| [10-core](10-core.md) | CoreIO, la capa compartida de la suite |
| [11-setup](11-setup.md) · [12-despliegue](12-despliegue.md) | Levantar el proyecto en local y desplegarlo |
| [15-ia](15-ia.md) | Qué redacta la IA, con qué datos y quién publica |
| [16-cumplimiento](16-cumplimiento.md) | Reprogramaciones, reprocesos y «a tiempo» |
| [17-arquitectura-tecnica](17-arquitectura-tecnica.md) | Cómo está armado el código: rutas, auth, jobs, deuda técnica, dónde mirar cuando algo falla |
| [18-seguridad](18-seguridad.md) | Revisiones y auditorías de seguridad, qué se corrigió |
| [19-kpis](19-kpis.md) | KPIs por persona y equipo |
| `manual/` | Manual de usuario con capturas (9,5 MB; si crece, conviene moverlo a Git LFS) |

Variables de entorno: `backend/.env.example` y `frontend/.env.example`. Registro de la auditoría del 10/10:
[`../HARDENING-CHANGELOG.md`](../HARDENING-CHANGELOG.md).
