import { Hono } from 'hono';
import { requireAuth } from '../../lib/auth/middleware';
import { clientes } from './clientes';
import { plantillas } from './plantillas';
import { proyectos } from './proyectos';
import { requerimientos } from './requerimientos';
import { semanas } from './semanas';
import { usuarios } from './usuarios';

export const v1 = new Hono();
v1.use('*', requireAuth);
v1.route('/clientes', clientes);
v1.route('/plantillas', plantillas);
v1.route('/proyectos', proyectos);
v1.route('/requerimientos', requerimientos);
v1.route('/semanas', semanas);
v1.route('/usuarios', usuarios);
