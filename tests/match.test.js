jest.mock('../src/db', () => ({ query: jest.fn(), connect: jest.fn() }));

const request = require('supertest');
const pool = require('../src/db');
const app = require('../src/app');
const { authHeader, rows } = require('./helpers');

beforeEach(() => jest.resetAllMocks());

const partido = {
  id: 1,
  user_id: 1,
  match_date: '2026-11-08',
  opponent: 'Club Atlético',
  minutes_played: 32,
  points: 21,
  rebounds: 7,
  assists: 5,
  steals: 2,
  blocks: 1,
  turnovers: 3,
  fouls: 2,
};
const { id, user_id, ...datos } = partido;

describe('GET /api/matches', () => {
  it('requiere autenticación', async () => {
    const res = await request(app).get('/api/matches');
    expect(res.status).toBe(401);
  });

  it('lista los partidos del usuario', async () => {
    pool.query.mockResolvedValueOnce(rows([partido]));
    const res = await request(app).get('/api/matches').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(pool.query.mock.calls[0][1]).toEqual([1]);
  });

  it('responde 500 si falla la base', async () => {
    pool.query.mockRejectedValueOnce(new Error('caída'));
    const res = await request(app).get('/api/matches').set(authHeader());
    expect(res.status).toBe(500);
  });
});

describe('POST /api/matches', () => {
  it('exige fecha y rival', async () => {
    const res = await request(app).post('/api/matches').set(authHeader()).send({ opponent: 'X' });
    expect(res.status).toBe(400);
  });

  it('rechaza estadísticas negativas', async () => {
    const res = await request(app).post('/api/matches').set(authHeader()).send({ ...datos, points: -3 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/points/);
  });

  it('rechaza estadísticas que no son enteros', async () => {
    const res = await request(app).post('/api/matches').set(authHeader()).send({ ...datos, rebounds: 2.5 });
    expect(res.status).toBe(400);
  });

  it('registra el partido', async () => {
    pool.query.mockResolvedValueOnce(rows([partido]));
    const res = await request(app).post('/api/matches').set(authHeader()).send(datos);
    expect(res.status).toBe(201);
    expect(res.body.match.opponent).toBe('Club Atlético');
  });

  it('guarda 0 en las estadísticas que no se envían', async () => {
    pool.query.mockResolvedValueOnce(rows([partido]));
    await request(app).post('/api/matches').set(authHeader()).send({ match_date: '2026-11-08', opponent: 'X' });
    expect(pool.query.mock.calls[0][1].slice(3)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('responde 500 si falla la base', async () => {
    pool.query.mockRejectedValueOnce(new Error('caída'));
    const res = await request(app).post('/api/matches').set(authHeader()).send(datos);
    expect(res.status).toBe(500);
  });
});

describe('PUT /api/matches/:id', () => {
  it('rechaza estadísticas inválidas', async () => {
    const res = await request(app).put('/api/matches/1').set(authHeader()).send({ fouls: -1 });
    expect(res.status).toBe(400);
  });

  it('responde 404 si el partido no existe o no es del usuario', async () => {
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await request(app).put('/api/matches/99').set(authHeader()).send({ points: 10 });
    expect(res.status).toBe(404);
  });

  it('actualiza los campos enviados y conserva el resto', async () => {
    pool.query
      .mockResolvedValueOnce(rows([partido]))
      .mockResolvedValueOnce(rows([{ ...partido, points: 30 }]));
    const res = await request(app).put('/api/matches/1').set(authHeader()).send({ points: 30 });
    expect(res.status).toBe(200);
    const valores = pool.query.mock.calls[1][1];
    expect(valores[0]).toBe(partido.match_date);
    expect(valores[1]).toBe(partido.opponent);
    expect(valores[3]).toBe(30);
    expect(valores[4]).toBe(partido.rebounds);
  });

  it('permite poner una estadística en 0', async () => {
    pool.query.mockResolvedValueOnce(rows([partido])).mockResolvedValueOnce(rows([{ ...partido, blocks: 0 }]));
    await request(app).put('/api/matches/1').set(authHeader()).send({ blocks: 0 });
    expect(pool.query.mock.calls[1][1][7]).toBe(0);
  });

  it('responde 500 si falla la base', async () => {
    pool.query.mockRejectedValueOnce(new Error('caída'));
    const res = await request(app).put('/api/matches/1').set(authHeader()).send({ points: 10 });
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/matches/:id', () => {
  it('elimina el partido', async () => {
    pool.query.mockResolvedValueOnce(rows([partido]));
    const res = await request(app).delete('/api/matches/1').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.deletedMatch.id).toBe(1);
  });

  it('responde 404 si no existe', async () => {
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await request(app).delete('/api/matches/99').set(authHeader());
    expect(res.status).toBe(404);
  });

  it('responde 500 si falla la base', async () => {
    pool.query.mockRejectedValueOnce(new Error('caída'));
    const res = await request(app).delete('/api/matches/1').set(authHeader());
    expect(res.status).toBe(500);
  });
});

describe('GET /api/matches/stats/monthly', () => {
  it('devuelve los promedios por mes', async () => {
    pool.query.mockResolvedValueOnce(rows([{ month: '2026-11', games_played: 1, avg_points: '21.0' }]));
    const res = await request(app).get('/api/matches/stats/monthly').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.monthly_stats[0].month).toBe('2026-11');
    expect(pool.query.mock.calls[0][1]).toEqual([1]);
  });

  it('filtra por año cuando se indica', async () => {
    pool.query.mockResolvedValueOnce(rows([]));
    await request(app).get('/api/matches/stats/monthly?year=2026').set(authHeader());
    expect(pool.query.mock.calls[0][0]).toMatch(/EXTRACT\(YEAR/);
    expect(pool.query.mock.calls[0][1]).toEqual([1, '2026']);
  });

  it('responde 500 si falla la base', async () => {
    pool.query.mockRejectedValueOnce(new Error('caída'));
    const res = await request(app).get('/api/matches/stats/monthly').set(authHeader());
    expect(res.status).toBe(500);
  });
});
