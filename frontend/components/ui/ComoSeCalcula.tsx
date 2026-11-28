'use client';
import { useEffect, useId, useState, type ReactNode } from 'react';

/**
 * «¿Cómo se calcula?»: la explicación de una métrica, a un clic y no como párrafo fijo en la pantalla.
 * Popover nativo (capa superior, se cierra con Esc o clic afuera); donde no hay Popover API, un <details>.
 */
export function ComoSeCalcula({ children, etiqueta = '¿Cómo se calcula?' }: { children: ReactNode; etiqueta?: string }) {
  const id = useId();
  const [nativo, setNativo] = useState(true);
  useEffect(() => setNativo(Object.hasOwn(HTMLElement.prototype, 'popover')), []);

  if (!nativo)
    return (
      <details className="text-xs text-gray-600">
        <summary className="cursor-pointer text-brand hover:underline">{etiqueta}</summary>
        <div className="mt-1 max-w-prose">{children}</div>
      </details>
    );
  return (
    <>
      <button type="button" popoverTarget={id} className="text-xs text-brand hover:underline underline-offset-2">
        {etiqueta}
      </button>
      <div
        id={id}
        popover="auto"
        className="max-w-md rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700 shadow-lg backdrop:bg-gray-900/10 space-y-2"
      >
        {children}
      </div>
    </>
  );
}
