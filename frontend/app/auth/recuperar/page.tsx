'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { BACKEND } from '@/lib/api';

export default function RecuperarPage() {
  const [email, setEmail] = useState('');
  const [estado, setEstado] = useState<'form' | 'enviando' | 'listo'>('form');
  async function enviar(e: FormEvent) {
    e.preventDefault(); setEstado('enviando');
    try { await fetch(`${BACKEND}/api/v1/auth/recuperar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }); } catch { /* siempre mostramos lo mismo */ }
    setEstado('listo');
  }
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="card w-full max-w-sm p-8 space-y-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/backio-icon.svg" alt="" width={36} height={36} className="rounded-lg" />
          <div><div className="font-bold text-lg">BackIO</div><div className="text-xs text-gray-500">Geeks Ecuador</div></div>
        </div>
        {estado === 'listo' ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">Si <b>{email}</b> tiene cuenta en BackIO, en un momento le llega un correo con el enlace para definir una contraseña nueva. Vence en 24 horas.</p>
            <p className="text-xs text-gray-500">¿No llega? Revisa spam o pide a un administrador que te reenvíe el acceso desde Admin → Usuarios.</p>
            <Link href="/login" className="btn-secondary w-full block text-center">Volver a entrar</Link>
          </div>
        ) : (
          <form onSubmit={enviar} className="space-y-3">
            <div>
              <div className="font-semibold">Recuperar contraseña</div>
              <p className="text-sm text-gray-600">Escribe tu correo y te mandamos un enlace para definir una nueva.</p>
            </div>
            <input className="input" type="email" autoComplete="email" placeholder="tu@geeks.com.ec" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            <button className="btn-primary w-full" disabled={estado === 'enviando'}>{estado === 'enviando' ? 'Enviando…' : 'Enviarme el enlace'}</button>
            <Link href="/login" className="block text-center text-sm link-action">Volver a entrar</Link>
          </form>
        )}
      </div>
    </main>
  );
}
