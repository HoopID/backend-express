jest.mock('../src/db', () => ({ query: jest.fn(), connect: jest.fn() }));

const request = require('supertest');
const bcrypt = require('bcryptjs');
const pool = require('../src/db');
const app = require('../src/app');
const { authHeader, rows } = require('./helpers');

beforeEach(() => jest.resetAllMocks());

describe('POST /api/auth/register', () => {
  it('exige email y contraseña', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'a@a.com' });
    expect(res.status).toBe(400);
  });

  it('rechaza un email ya registrado', async () => {
    pool.query.mockResolvedValueOnce(rows([{ id: 1 }]));
    const res = await request(app).post('/api/auth/register').send({ email: 'a@a.com', password: 'clave123' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/registrado/);
  });

  it('registra al usuario y guarda la contraseña encriptada', async () => {
    pool.query
      .mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([{ id: 7, email: 'a@a.com', created_at: null }]));
    const res = await request(app).post('/api/auth/register').send({ email: 'a@a.com', password: 'clave123' });
    expect(res.status).toBe(201);
    expect(res.body.user.id).toBe(7);
    const guardada = pool.query.mock.calls[1][1][1];
    expect(guardada).not.toBe('clave123');
    expect(bcrypt.compareSync('clave123', guardada)).toBe(true);
  });

  it('responde 500 si falla la base', async () => {
    pool.query.mockRejectedValueOnce(new Error('caída'));
    const res = await request(app).post('/api/auth/register').send({ email: 'a@a.com', password: 'clave123' });
    expect(res.status).toBe(500);
  });
});

describe('POST /api/auth/login', () => {
  const hash = bcrypt.hashSync('clave123', 4);

  it('exige email y contraseña', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });

  it('rechaza un usuario inexistente', async () => {
    pool.query.mockResolvedValueOnce(rows([]));
    const res = await request(app).post('/api/auth/login').send({ email: 'x@x.com', password: 'clave123' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Credenciales inválidas');
  });

  it('rechaza una contraseña incorrecta', async () => {
    pool.query.mockResolvedValueOnce(rows([{ id: 1, email: 'a@a.com', password: hash }]));
    const res = await request(app).post('/api/auth/login').send({ email: 'a@a.com', password: 'otra' });
    expect(res.status).toBe(400);
  });

  it('devuelve un token con credenciales correctas', async () => {
    pool.query.mockResolvedValueOnce(rows([{ id: 1, email: 'a@a.com', password: hash }]));
    const res = await request(app).post('/api/auth/login').send({ email: 'a@a.com', password: 'clave123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toEqual({ id: 1, email: 'a@a.com' });
  });

  it('responde 500 si falla la base', async () => {
    pool.query.mockRejectedValueOnce(new Error('caída'));
    const res = await request(app).post('/api/auth/login').send({ email: 'a@a.com', password: 'clave123' });
    expect(res.status).toBe(500);
  });
});

describe('GET /api/auth/me y middleware de autenticación', () => {
  it('sin token responde 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('con token inválido responde 403', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer token-falso');
    expect(res.status).toBe(403);
  });

  it('con token válido devuelve el usuario', async () => {
    const res = await request(app).get('/api/auth/me').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(1);
  });
});
