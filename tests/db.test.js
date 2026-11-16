const mockPool = jest.fn();
const mockSetTypeParser = jest.fn();

jest.mock('pg', () => ({
  Pool: function Pool(config) {
    mockPool(config);
  },
  types: { setTypeParser: (...args) => mockSetTypeParser(...args) },
}));

describe('src/db.js', () => {
  it('crea el Pool con las variables de entorno y devuelve las fechas DATE como texto', () => {
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5433';
    process.env.DB_USER = 'usuario';
    process.env.DB_PASSWORD = 'clave-de-prueba';
    process.env.DB_NAME = 'hoopid_test';

    require('../src/db');

    expect(mockPool).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'localhost', port: '5433', user: 'usuario', database: 'hoopid_test' })
    );
    const [oid, parser] = mockSetTypeParser.mock.calls[0];
    expect(oid).toBe(1082);
    expect(parser('2026-11-08')).toBe('2026-11-08');
  });
});
