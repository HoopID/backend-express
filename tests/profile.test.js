jest.mock('../src/db', () => ({ query: jest.fn(), connect: jest.fn() }));

const request = require('supertest');
const pool = require('../src/db');
const app = require('../src/app');
const { authHeader, rows } = require('./helpers');

beforeEach(() => jest.resetAllMocks());

const perfil = { first_name: 'Juan', last_name: 'Pérez', height_cm: 190, position: 'Escolta', current_club: 'Club A' };

describe('GET /api/profile', () => {
  it('requiere autenticación', async () => {
    const res = await request(app).get('/api/profile');
    expect(res.status).toBe(401);
  });

  it('devuelve profile null si todavía no existe', async () => {
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await request(app).get('/api/profile').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.profile).toBeNull();
  });

  it('devuelve el perfil existente', async () => {
    pool.query.mockResolvedValueOnce(rows([{ id: 1, user_id: 1, ...perfil }]));
    const res = await request(app).get('/api/profile').set(authHeader());
    expect(res.body.profile.first_name).toBe('Juan');
  });

  it('responde 500 si falla la base', async () => {
    pool.query.mockRejectedValueOnce(new Error('caída'));
    const res = await request(app).get('/api/profile').set(authHeader());
    expect(res.status).toBe(500);
  });
});

describe('PUT /api/profile', () => {
  it('crea el perfil si no existía', async () => {
    pool.query.mockResolvedValueOnce(rows([])).mockResolvedValueOnce(rows([{ id: 1, user_id: 1, ...perfil }]));
    const res = await request(app).put('/api/profile').set(authHeader()).send(perfil);
    expect(res.status).toBe(200);
    expect(pool.query.mock.calls[1][0]).toMatch(/INSERT INTO profiles/);
  });

  it('actualiza el perfil si ya existía', async () => {
    pool.query
      .mockResolvedValueOnce(rows([{ id: 1 }]))
      .mockResolvedValueOnce(rows([{ id: 1, user_id: 1, ...perfil, current_club: 'Club B' }]));
    const res = await request(app).put('/api/profile').set(authHeader()).send({ ...perfil, current_club: 'Club B' });
    expect(res.status).toBe(200);
    expect(pool.query.mock.calls[1][0]).toMatch(/UPDATE profiles/);
    expect(res.body.profile.current_club).toBe('Club B');
  });

  it('responde 500 si falla la base', async () => {
    pool.query.mockRejectedValueOnce(new Error('caída'));
    const res = await request(app).put('/api/profile').set(authHeader()).send(perfil);
    expect(res.status).toBe(500);
  });
});
