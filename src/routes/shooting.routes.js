const express = require('express');
const router = express.Router();
const pool = require('../db');
const authenticateToken = require('../middlewares/auth.middleware');

// POST /api/shooting-sessions - Crear una nueva sesión de tiro
router.post('/', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { session_date, shot_zone, attempts, made } = req.body;

  if (!session_date || !shot_zone || attempts === undefined || made === undefined) {
    return res.status(400).json({ message: 'Todos los campos (session_date, shot_zone, attempts, made) son obligatorios' });
  }

  if (attempts <= 0) {
    return res.status(400).json({ message: 'Los intentos deben ser mayores a 0' });
  }

  if (made > attempts) {
    return res.status(400).json({ message: 'Los tiros convertidos no pueden superar los intentos totales' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO shooting_sessions (user_id, session_date, shot_zone, attempts, made, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id, user_id, session_date, shot_zone, attempts, made, created_at,
                 ROUND((made::decimal / attempts) * 100, 2) AS accuracy_percentage`,
      [userId, session_date, shot_zone, attempts, made]
    );

    res.status(201).json({
      message: 'Registro de tiro creado exitosamente',
      session: result.rows[0],
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al registrar la sesión de tiro', error: error.message });
  }
});

// GET /api/shooting-sessions - Obtener todos los registros de tiro del usuario
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      'SELECT * FROM shooting_sessions WHERE user_id = $1 ORDER BY session_date DESC',
      [userId]
    );

    const sessions = result.rows.map((session) => ({
      ...session,
      accuracy_percentage: session.attempts > 0 ? Math.round((session.made / session.attempts) * 100 * 100) / 100 : 0,
    }));

    res.json({
      message: 'Registros de tiro obtenidos exitosamente',
      sessions,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener los registros de tiro', error: error.message });
  }
});

// PUT /api/shooting-sessions/:id - Actualizar un registro de tiro
router.put('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { session_date, shot_zone, attempts, made } = req.body;

  // Validar que el registro pertenezca al usuario autenticado
  try {
    const userId = req.user.id;
    const existingSession = await pool.query(
      'SELECT * FROM shooting_sessions WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (existingSession.rows.length === 0) {
      return res.status(404).json({ message: 'Registro no encontrado' });
    }

    // Validar formato de fecha
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (session_date && !dateRegex.test(session_date)) {
      return res.status(400).json({ message: 'session_date debe tener el formato YYYY-MM-DD' });
    }

    // Validar que made no sea mayor que attempts
    if (made !== undefined && attempts !== undefined && made > attempts) {
      return res.status(400).json({ message: 'made no puede ser mayor que attempts' });
    }

    const result = await pool.query(
      `UPDATE shooting_sessions SET
         session_date = COALESCE($2, session_date),
         shot_zone = COALESCE($3, shot_zone),
         attempts = COALESCE($4, attempts),
         made = COALESCE($5, made)
       WHERE id = $1
       RETURNING *`,
      [id, session_date, shot_zone, attempts, made]
    );

    res.json({
      message: 'Registro de tiro actualizado exitosamente',
      session: result.rows[0],
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar el registro de tiro', error: error.message });
  }
});

// DELETE /api/shooting-sessions/:id - Eliminar un registro de tiro
router.delete('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const userId = req.user.id;
    const result = await pool.query(
      'DELETE FROM shooting_sessions WHERE id = $1 AND user_id = $2',
      [id, userId]
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