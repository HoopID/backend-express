const express = require('express');
const router = express.Router();
const pool = require('../db');
const authenticateToken = require('../middlewares/auth.middleware');

// GET /api/matches - Listar todos los partidos del usuario
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      `SELECT * FROM match_boxscores 
       WHERE user_id = $1 
       ORDER BY match_date DESC, created_at DESC`,
      [userId]
    );

    res.json({
      message: 'Partidos obtenidos exitosamente',
      count: result.rows.length,
      matches: result.rows,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener los partidos', error: error.message });
  }
});

// POST /api/matches - Registrar un nuevo partido (Boxscore)
router.post('/', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const {
    match_date,
    opponent,
    minutes_played,
    points,
    rebounds,
    assists,
    steals,
    blocks,
    turnovers,
    fouls
  } = req.body;

  if (!match_date || !opponent) {
    return res.status(400).json({ message: 'La fecha (match_date) y el rival (opponent) son obligatorios' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO match_boxscores (
        user_id, match_date, opponent, minutes_played, points,
        rebounds, assists, steals, blocks, turnovers, fouls, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      RETURNING *`,
      [
        userId,
        match_date,
        opponent,
        minutes_played || 0,
        points || 0,
        rebounds || 0,
        assists || 0,
        steals || 0,
        blocks || 0,
        turnovers || 0,
        fouls || 0
      ]
    );

    res.status(201).json({
      message: 'Partido registrado exitosamente',
      match: result.rows[0],
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al registrar el partido', error: error.message });
  }
});

// PUT /api/matches/:id - Editar un partido existente
router.put('/:id', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const {
    match_date,
    opponent,
    minutes_played,
    points,
    rebounds,
    assists,
    steals,
    blocks,
    turnovers,
    fouls
  } = req.body;

  try {
    const checkMatch = await pool.query(
      'SELECT * FROM match_boxscores WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (checkMatch.rows.length === 0) {
      return res.status(404).json({ message: 'Partido no encontrado o no pertenece al usuario' });
    }

    const current = checkMatch.rows[0];

    const result = await pool.query(
      `UPDATE match_boxscores SET
        match_date = $1,
        opponent = $2,
        minutes_played = $3,
        points = $4,
        rebounds = $5,
        assists = $6,
        steals = $7,
        blocks = $8,
        turnovers = $9,
        fouls = $10
      WHERE id = $11 AND user_id = $12
      RETURNING *`,
      [
        match_date || current.match_date,
        opponent || current.opponent,
        minutes_played !== undefined ? minutes_played : current.minutes_played,
        points !== undefined ? points : current.points,
        rebounds !== undefined ? rebounds : current.rebounds,
        assists !== undefined ? assists : current.assists,
        steals !== undefined ? steals : current.steals,
        blocks !== undefined ? blocks : current.blocks,
        turnovers !== undefined ? turnovers : current.turnovers,
        fouls !== undefined ? fouls : current.fouls,
        id,
        userId
      ]
    );

    res.json({
      message: 'Partido actualizado exitosamente',
      match: result.rows[0],
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar el partido', error: error.message });
  }
});

// DELETE /api/matches/:id - Eliminar un partido
router.delete('/:id', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM match_boxscores WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Partido no encontrado o no pertenece al usuario' });
    }

    res.json({
      message: 'Partido eliminado exitosamente',
      deletedMatch: result.rows[0],
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar el partido', error: error.message });
  }
});

// GET /api/matches/stats/monthly - Obtener promedios y totales agrupados por mes
router.get('/stats/monthly', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { year } = req.query;

  try {
    let query = `
      SELECT 
        TO_CHAR(match_date, 'YYYY-MM') AS month,
        COUNT(id)::int AS games_played,
        ROUND(AVG(points), 1) AS avg_points,
        ROUND(AVG(rebounds), 1) AS avg_rebounds,
        ROUND(AVG(assists), 1) AS avg_assists,
        ROUND(AVG(steals), 1) AS avg_steals,
        ROUND(AVG(blocks), 1) AS avg_blocks,
        ROUND(AVG(minutes_played), 1) AS avg_minutes
      FROM match_boxscores
      WHERE user_id = $1
    `;

    const params = [userId];

    if (year) {
      query += ` AND EXTRACT(YEAR FROM match_date) = $2`;
      params.push(year);
    }

    query += ` GROUP BY TO_CHAR(match_date, 'YYYY-MM') ORDER BY month DESC`;

    const result = await pool.query(query, params);

    res.json({
      message: 'Estadísticas mensuales calculadas exitosamente',
      monthly_stats: result.rows,
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al calcular estadísticas mensuales', error: error.message });
  }
});

module.exports = router;