const express = require('express');
const router = express.Router();
const pool = require('../db');
const authenticateToken = require('../middlewares/auth.middleware');
const { SHOT_ZONES } = require('../constants/zones');

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Consulta base: una fila por sesión con sus zonas (spots) y totales.
const SESSION_SELECT = `
  SELECT s.id, s.user_id, s.session_date::text AS session_date, s.created_at,
         COALESCE(
           json_agg(
             json_build_object('zone', p.zone, 'attempts', p.attempts, 'made', p.made)
             ORDER BY p.zone
           ) FILTER (WHERE p.id IS NOT NULL),
           '[]'
         ) AS spots,
         COALESCE(SUM(p.attempts), 0)::int AS attempts,
         COALESCE(SUM(p.made), 0)::int AS made
  FROM shooting_sessions s
  LEFT JOIN shooting_session_spots p ON p.session_id = s.id`;

const withAccuracy = (session) => ({
  ...session,
  accuracy_percentage:
    session.attempts > 0 ? Math.round((session.made / session.attempts) * 10000) / 100 : 0,
});

// Devuelve un mensaje de error si el body es inválido, o null si es correcto.
const validateSpots = (spots) => {
  if (!Array.isArray(spots) || spots.length === 0) {
    return 'Debes enviar al menos una zona en "spots"';
  }
  const seen = new Set();
  for (const spot of spots) {
    const { zone, attempts, made } = spot || {};
    if (!SHOT_ZONES.includes(zone)) {
      return `Zona de tiro inválida: ${zone}`;
    }
    if (seen.has(zone)) {
      return `La zona ${zone} está repetida`;
    }
    seen.add(zone);
    if (!Number.isInteger(attempts) || attempts <= 0) {
      return `Los intentos de ${zone} deben ser un entero mayor a 0`;
    }
    if (!Number.isInteger(made) || made < 0) {
      return `Los aciertos de ${zone} deben ser un entero mayor o igual a 0`;
    }
    if (made > attempts) {
      return `Los aciertos de ${zone} no pueden superar los intentos`;
    }
  }
  return null;
};

const insertSpots = async (client, sessionId, spots) => {
  for (const { zone, attempts, made } of spots) {
    await client.query(
      'INSERT INTO shooting_session_spots (session_id, zone, attempts, made) VALUES ($1, $2, $3, $4)',
      [sessionId, zone, attempts, made]
    );
  }
};

const fetchSession = async (db, id, userId) => {
  const result = await db.query(
    `${SESSION_SELECT} WHERE s.id = $1 AND s.user_id = $2 GROUP BY s.id`,
    [id, userId]
  );
  return result.rows[0] ? withAccuracy(result.rows[0]) : null;
};

// POST /api/shooting-sessions - Crear una sesión con una o más zonas
router.post('/', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { session_date, spots } = req.body;

  if (!session_date || !DATE_REGEX.test(session_date)) {
    return res.status(400).json({ message: 'session_date es obligatorio con formato YYYY-MM-DD' });
  }
  const spotsError = validateSpots(spots);
  if (spotsError) {
    return res.status(400).json({ message: spotsError });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await client.query(
      `INSERT INTO shooting_sessions (user_id, session_date, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW()) RETURNING id`,
      [userId, session_date]
    );
    const sessionId = created.rows[0].id;
    await insertSpots(client, sessionId, spots);
    await client.query('COMMIT');

    const session = await fetchSession(pool, sessionId, userId);
    res.status(201).json({ message: 'Sesión de tiro creada exitosamente', session });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Error al registrar la sesión de tiro', error: error.message });
  } finally {
    client.release();
  }
});

// GET /api/shooting-sessions - Todas las sesiones del usuario, con sus zonas
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `${SESSION_SELECT}
       WHERE s.user_id = $1
       GROUP BY s.id
       ORDER BY s.session_date DESC, s.id DESC`,
      [req.user.id]
    );

    res.json({
      message: 'Registros de tiro obtenidos exitosamente',
      sessions: result.rows.map(withAccuracy),
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener los registros de tiro', error: error.message });
  }
});

// PUT /api/shooting-sessions/:id - Actualizar fecha y/o reemplazar las zonas
router.put('/:id', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const { session_date, spots } = req.body;

  if (session_date !== undefined && !DATE_REGEX.test(session_date)) {
    return res.status(400).json({ message: 'session_date debe tener el formato YYYY-MM-DD' });
  }
  if (spots !== undefined) {
    const spotsError = validateSpots(spots);
    if (spotsError) {
      return res.status(400).json({ message: spotsError });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE shooting_sessions
       SET session_date = COALESCE($2, session_date), updated_at = NOW()
       WHERE id = $1 AND user_id = $3
       RETURNING id`,
      [id, session_date ?? null, userId]
    );

    if (updated.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Registro no encontrado' });
    }

    if (spots !== undefined) {
      await client.query('DELETE FROM shooting_session_spots WHERE session_id = $1', [id]);
      await insertSpots(client, id, spots);
    }
    await client.query('COMMIT');

    const session = await fetchSession(pool, id, userId);
    res.json({ message: 'Registro de tiro actualizado exitosamente', session });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Error al actualizar el registro de tiro', error: error.message });
  } finally {
    client.release();
  }
});

// DELETE /api/shooting-sessions/:id - Eliminar la sesión (sus zonas se borran en cascada)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM shooting_sessions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Registro no encontrado' });
    }

    res.json({ message: 'Registro de tiro eliminado exitosamente' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar el registro de tiro', error: error.message });
  }
});

module.exports = router;
