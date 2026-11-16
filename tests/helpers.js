const jwt = require('jsonwebtoken');

// Token válido para el usuario 1 (las rutas privadas leen req.user.id)
const authHeader = () => ({
  Authorization: `Bearer ${jwt.sign({ id: 1, email: 'jugador@test.com' }, process.env.JWT_SECRET)}`,
});

// Resultado de pool.query: { rows, rowCount }
const rows = (list) => ({ rows: list, rowCount: list.length });

module.exports = { authHeader, rows };
