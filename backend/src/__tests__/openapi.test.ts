import { describe, expect, it } from 'vitest';

import { buildSpec } from '../routes/openapi';

type Props = { properties?: Record<string, unknown> };

// Auditoría 10/10: el spec copiaba los esquemas y se quedó sin planificacion, clase ni proactiva.
describe('OpenAPI desde los esquemas de las rutas', () => {
  const spec = buildSpec('https://backio.test') as unknown as { components: { schemas: Record<string, Props> } };
  const campos = (n: string) => Object.keys(spec.components.schemas[n]?.properties ?? {});

  it('crear y actualizar requerimiento traen los campos que la ruta acepta', () => {
    expect(campos('CrearRequerimiento')).toEqual(expect.arrayContaining(['planificacion', 'clase', 'proactiva']));
    expect(campos('ActualizarRequerimiento')).toEqual(
      expect.arrayContaining(['planificacion', 'daily_fecha', 'clase', 'proactiva', 'motivo_reprogramacion']),
    );
  });
  it('crear proyecto y acuerdo vienen de sus rutas', () => {
    expect(campos('CrearProyecto')).toEqual(expect.arrayContaining(['fecha_inicio', 'repetir_mensual']));
    expect(campos('Acuerdo')).toEqual(['descripcion', 'responsable_id', 'fecha_compromiso']);
  });
});
