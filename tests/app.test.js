jest.mock('../src/db', () => ({ query: jest.fn(), connect: jest.fn() }));

const request = require('supertest');
const pool = require('../src/db');
const app = require('../src/app');

beforeEach(() => jest.resetAllMocks());

describe('GET /api/health', () => {
  it('responde ok con la hora de la base', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ now: '2026-11-16T10:00:00Z' }] });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db_time: '2026-11-16T10:00:00Z' });
  });

  it('responde 500 si la base no responde', async () => {
    pool.query.mockRejectedValueOnce(new Error('sin conexión'));
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(500);
    expect(res.body.status).toBe('error');
  });
});
