jest.mock('../src/db', () => ({ query: jest.fn(), connect: jest.fn() }));

const request = require('supertest');
const pool = require('../src/db');
const app = require('../src/app');
const { authHeader, rows } = require('./helpers');

// Cliente de transacción simulado: BEGIN/COMMIT/ROLLBACK/INSERT/DELETE responden bien salvo que se pida fallar
let client;
const makeClient = ({ sessionId = 5, updateRows = [{ id: 5 }], failOn } = {}) => {
  client = {
    release: jest.fn(),
    query: jest.fn(async (sql) => {
      if (failOn && failOn.test(sql)) throw new Error('falla simulada');
      if (/INSERT INTO shooting_sessions/.test(sql)) return rows([{ id: sessionId }]);
      if (/UPDATE shooting_sessions/.test(sql)) return rows(updateRows);
      return rows([]);
    }),
  };
  pool.connect.mockResolvedValue(client);
};

const sesionCompleta = {
  id: 5,
  user_id: 1,
  session_date: '2026-11-10',
  attempts: 30,
  made: 15,
  zones: [
    { id: 1, zone: 'paint', attempts: 10, made: 8 },
    { id: 2, zone: 'top', attempts: 20, made: 7 },
  ],
};

const body = (extra = {}) => ({
  session_date: '2026-11-10',
  zones: [
    { zone: 'paint', attempts: 10, made: 8 },
    { zone: 'top', attempts: 20, made: 7 },
  ],
  ...extra,
});

beforeEach(() => {
  jest.resetAllMocks();
});

describe('GET /api/shooting-sessions/zones', () => {
  it('lista las zonas válidas del mapa de tiro', async () => {
    const res = await request(app).get('/api/shooting-sessions/zones').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.zones).toEqual(expect.arrayContaining(['paint', 'free_throw', 'elbow_left', 'elbow_right', 'top']));
  });
});

describe('POST /api/shooting-sessions', () => {
  it('requiere autenticación', async () => {
    const res = await request(app).post('/api/shooting-sessions').send(body());
    expect(res.status).toBe(401);
  });

  it.each([
    ['sin fecha', body({ session_date: undefined })],
    ['fecha con formato inválido', body({ session_date: '10/11/2026' })],
    ['sin zonas', body({ zones: [] })],
    ['zonas que no son un arreglo', body({ zones: 'paint' })],
    ['una zona inexistente', body({ zones: [{ zone: 'luna', attempts: 5, made: 1 }] })],
    ['una zona repetida', body({ zones: [{ zone: 'paint', attempts: 5, made: 1 }, { zone: 'paint', attempts: 5, made: 1 }] })],
    ['intentos en cero', body({ zones: [{ zone: 'paint', attempts: 0, made: 0 }] })],
    ['aciertos negativos', body({ zones: [{ zone: 'paint', attempts: 5, made: -1 }] })],
    ['más aciertos que intentos', body({ zones: [{ zone: 'paint', attempts: 5, made: 9 }] })],
    ['un elemento vacío en zonas', body({ zones: [null] })],
  ])('rechaza %s', async (_nombre, payload) => {
    const res = await request(app).post('/api/shooting-sessions').set(authHeader()).send(payload);
    expect(res.status).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('crea la sesión con sus zonas dentro de una transacción', async () => {
    makeClient();
    pool.query.mockResolvedValueOnce(rows([sesionCompleta]));
    const res = await request(app).post('/api/shooting-sessions').set(authHeader()).send(body());
    expect(res.status).toBe(201);
    expect(res.body.session.zones).toHaveLength(2);
    expect(res.body.session.accuracy_percentage).toBe(50);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls.filter((s) => /INSERT INTO shooting_session_zones/.test(s))).toHaveLength(2);
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  it('hace ROLLBACK y responde 500 si falla al guardar una zona', async () => {
    makeClient({ failOn: /INSERT INTO shooting_session_zones/ });
    const res = await request(app).post('/api/shooting-sessions').set(authHeader()).send(body());
    expect(res.status).toBe(500);
    expect(client.query.mock.calls.map((c) => c[0])).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

describe('GET /api/shooting-sessions', () => {
  it('devuelve las sesiones con su efectividad', async () => {
    pool.query.mockResolvedValueOnce(rows([sesionCompleta, { ...sesionCompleta, id: 6, attempts: 0, made: 0, zones: [] }]));
    const res = await request(app).get('/api/shooting-sessions').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.sessions[0].accuracy_percentage).toBe(50);
    expect(res.body.sessions[1].accuracy_percentage).toBe(0);
  });

  it('responde 500 si falla la base', async () => {
    pool.query.mockRejectedValueOnce(new Error('caída'));
    const res = await request(app).get('/api/shooting-sessions').set(authHeader());
    expect(res.status).toBe(500);
  });
});

describe('PUT /api/shooting-sessions/:id', () => {
  it('rechaza una fecha inválida', async () => {
    const res = await request(app).put('/api/shooting-sessions/5').set(authHeader()).send({ session_date: 'mañana' });
    expect(res.status).toBe(400);
  });

  it('rechaza zonas inválidas', async () => {
    const res = await request(app)
      .put('/api/shooting-sessions/5')
      .set(authHeader())
      .send({ zones: [{ zone: 'paint', attempts: 2, made: 3 }] });
    expect(res.status).toBe(400);
  });

  it('responde 404 si la sesión no existe o no es del usuario', async () => {
    makeClient({ updateRows: [] });
    const res = await request(app).put('/api/shooting-sessions/99').set(authHeader()).send({ session_date: '2026-11-11' });
    expect(res.status).toBe(404);
    expect(client.query.mock.calls.map((c) => c[0])).toContain('ROLLBACK');
  });

  it('cambia solo la fecha si no se envían zonas', async () => {
    makeClient();
    pool.query.mockResolvedValueOnce(rows([{ ...sesionCompleta, session_date: '2026-11-11' }]));
    const res = await request(app).put('/api/shooting-sessions/5').set(authHeader()).send({ session_date: '2026-11-11' });
    expect(res.status).toBe(200);
    expect(client.query.mock.calls.map((c) => c[0]).some((s) => /DELETE FROM shooting_session_zones/.test(s))).toBe(false);
  });

  it('reemplaza las zonas cuando se envían', async () => {
    makeClient();
    pool.query.mockResolvedValueOnce(rows([sesionCompleta]));
    const res = await request(app)
      .put('/api/shooting-sessions/5')
      .set(authHeader())
      .send({ zones: [{ zone: 'elbow_left', attempts: 6, made: 4 }] });
    expect(res.status).toBe(200);
    const sqls = client.query.mock.calls.map((c) => c[0]);
    expect(sqls.some((s) => /DELETE FROM shooting_session_zones/.test(s))).toBe(true);
    expect(sqls.filter((s) => /INSERT INTO shooting_session_zones/.test(s))).toHaveLength(1);
  });

  it('responde 500 si falla la base', async () => {
    makeClient({ failOn: /UPDATE shooting_sessions/ });
    const res = await request(app).put('/api/shooting-sessions/5').set(authHeader()).send({ session_date: '2026-11-11' });
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/shooting-sessions/:id', () => {
  it('elimina la sesión', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = await request(app).delete('/api/shooting-sessions/5').set(authHeader());
    expect(res.status).toBe(200);
    expect(pool.query.mock.calls[0][1]).toEqual(['5', 1]);
  });

  it('responde 404 si no existe', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await request(app).delete('/api/shooting-sessions/99').set(authHeader());
    expect(res.status).toBe(404);
  });

  it('responde 500 si falla la base', async () => {
    pool.query.mockRejectedValueOnce(new Error('caída'));
    const res = await request(app).delete('/api/shooting-sessions/5').set(authHeader());
    expect(res.status).toBe(500);
  });
});
