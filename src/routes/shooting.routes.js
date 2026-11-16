const express = require('express');
const router = express.Router();
const pool = require('../db');
const authenticateToken = require('../middlewares/auth.middleware');
const { SHOT_ZONES } = require('../constants/zones');

// Una sesión = fecha + varias zonas del mapa de tiro (cada una con sus intentos y aciertos).
// Devuelve la sesión con `zones`, y los totales `attempts`, `made` y `accuracy_percentage`.
const SESSION_SELECT = `
  SELECT s.id, s.user_id, s.session_date::text AS session_date, s.created_at, s.updated_at,
         COALESCE(SUM(z.attempts), 0)::int AS attempts,
         COALESCE(SUM(z.made), 0)::int AS made,
         COALESCE(
           json_agg(json_build_object('id', z.id, 'zone', z.zone, 'attempts', z.attempts, 'made', z.made)
                    ORDER BY z.id) FILTER (WHERE z.id IS NOT NULL),
           '[]'::json
         ) AS zones
  FROM shooting_sessions s
  LEFT JOIN shooting_session_zones z ON z.session_id = s.id`;

const withAccuracy = (row) => ({
  ...row,
  accuracy_percentage: row.attempts > 0 ? Math.round((row.made / row.attempts) * 10000) / 100 : 0,
});

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Valida el arreglo de zonas. Devuelve { error } o { zones } ya normalizado.
function validateZones(zones) {
  if (!Array.isArray(zones) || zones.length === 0) {
    return { error: 'Cargá al menos una zona (zones) con sus intentos y aciertos' };
  }
  const seen = new Set();
  const clean = [];
  for (const z of zones) {
    const zone = z && z.zone;
    const attempts = Number(z && z.attempts);
    const made = Number(z && z.made);
    if (!SHOT_ZONES.includes(zone)) {
      return { error: `Zona inválida: ${zone}` };
    }
    if (seen.has(zone)) {
      return { error: `La zona ${zone} está repetida en la sesión` };
    }
    seen.add(zone);
    if (!Number.isInteger(attempts) || attempts <= 0) {
      return { error: `Los intentos de la zona ${zone} deben ser un entero mayor a 0` };
    }
    if (!Number.isInteger(made) || made < 0) {
      return { error: `Los aciertos de la zona ${zone} deben ser un entero mayor o igual a 0` };
    }
    if (made > attempts) {
      return { error: `En la zona ${zone} los aciertos no pueden superar los intentos` };
    }
    clean.push({ zone, attempts, made });
  }
  return { zones: clean };
}

async function insertZones(client, sessionId, zones) {
  for (const z of zones) {
    await client.query(
      'INSERT INTO shooting_session_zones (session_id, zone, attempts, made) VALUES ($1, $2, $3, $4)',
      [sessionId, z.zone, z.attempts, z.made]
    );
  }
}

async function loadSession(db, id, userId) {
  const result = await db.query(`${SESSION_SELECT} WHERE s.id = $1 AND s.user_id = $2 GROUP BY s.id`, [id, userId]);
  return result.rows[0] ? withAccuracy(result.rows[0]) : null;
}

// GET /api/shooting-sessions/zones - Zonas válidas del mapa de tiro
router.get('/zones', authenticateToken, (req, res) => {
  res.json({ zones: SHOT_ZONES });
});

// POST /api/shooting-sessions - Crear una sesión con varias zonas
router.post('/', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { session_date, zones } = req.body;

  if (!session_date || !DATE_REGEX.test(session_date)) {
    return res.status(400).json({ message: 'session_date es obligatorio y debe tener el formato YYYY-MM-DD' });
  }
  const check = validateZones(zones);
  if (check.error) {
    return res.status(400).json({ message: check.error });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await client.query(
      `INSERT INTO shooting_sessions (user_id, session_date, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW()) RETURNING id`,
      [userId, session_date]
    );
    await insertZones(client, created.rows[0].id, check.zones);
    await client.query('COMMIT');

    const session = await loadSession(pool, created.rows[0].id, userId);
    res.status(201).json({ message: 'Sesión de tiro creada exitosamente', session });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: 'Error al registrar la sesión de tiro', error: error.message });
  } finally {
    client.release();
  }
});

// GET /api/shooting-sessions - Todas las sesiones del usuario (con sus zonas)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `${SESSION_SELECT} WHERE s.user_id = $1 GROUP BY s.id ORDER BY s.session_date DESC, s.id DESC`,
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

// PUT /api/shooting-sessions/:id - Editar fecha y/o reemplazar las zonas de la sesión
router.put('/:id', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const { session_date, zones } = req.body;

  if (session_date !== undefined && !DATE_REGEX.test(session_date)) {
    return res.status(400).json({ message: 'session_date debe tener el formato YYYY-MM-DD' });
  }
  let cleanZones;
  if (zones !== undefined) {
    const check = validateZones(zones);
    if (check.error) {
      return res.status(400).json({ message: check.error });
    }
    cleanZones = check.zones;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE shooting_sessions SET session_date = COALESCE($1, session_date), updated_at = NOW()
       WHERE id = $2 AND user_id = $3 RETURNING id`,
      [session_date || null, id, userId]
    );
    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Registro no encontrado' });
    }
    if (cleanZones) {
      await client.query('DELETE FROM shooting_session_zones WHERE session_id = $1', [id]);
      await insertZones(client, id, cleanZones);
    }
    await client.query('COMMIT');

    const session = await loadSession(pool, id, userId);
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
