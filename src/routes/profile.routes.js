const express = require('express');
const router = express.Router();
const pool = require('../db');
const authenticateToken = require('../middlewares/auth.middleware');

// GET /api/profile - Obtener el perfil del usuario autenticado
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const profileResult = await pool.query(
      'SELECT * FROM profiles WHERE user_id = $1',
      [userId]
    );

    if (profileResult.rows.length === 0) {
      return res.status(200).json({
        message: 'Perfil no encontrado. Puedes crearlo utilizando el método PUT.',
        profile: null,
      });
    }

    res.json({
      message: 'Perfil obtenido exitosamente',
      profile: profileResult.rows[0],
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener el perfil', error: error.message });
  }
});

// PUT /api/profile - Crear o actualizar el perfil del usuario autenticado
router.put('/', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const {
    first_name,
    last_name,
    height_cm,
    weight_kg,
    wingspan_cm,
    position,
    dominant_hand,
    vertical_leap_cm,
    current_club,
    selection_team,
  } = req.body;

  try {
    // Verificar si el perfil ya existe
    const existingProfile = await pool.query(
      'SELECT * FROM profiles WHERE user_id = $1',
      [userId]
    );

    let updatedProfile;

    if (existingProfile.rows.length > 0) {
      // Actualizar perfil existente
      updatedProfile = await pool.query(
        `UPDATE profiles SET
          first_name = $1,
          last_name = $2,
          height_cm = $3,
          weight_kg = $4,
          wingspan_cm = $5,
          position = $6,
          dominant_hand = $7,
          vertical_leap_cm = $8,
          current_club = $9,
          selection_team = $10
        WHERE user_id = $11
        RETURNING *`,
        [
          first_name,
          last_name,
          height_cm,
          weight_kg,
          wingspan_cm,
          position,
          dominant_hand,
          vertical_leap_cm,
          current_club,
          selection_team,
          userId,
        ]
      );
    } else {
      // Crear perfil nuevo si no existía
      updatedProfile = await pool.query(
        `INSERT INTO profiles (
          user_id, first_name, last_name, height_cm, weight_kg,
          wingspan_cm, position, dominant_hand, vertical_leap_cm,
          current_club, selection_team
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
          userId,
          first_name,
          last_name,
          height_cm,
          weight_kg,
          wingspan_cm,
          position,
          dominant_hand,
          vertical_leap_cm,
          current_club,
          selection_team,
        ]
      );
    }

    res.json({
      message: 'Perfil guardado exitosamente',
      profile: updatedProfile.rows[0],
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar el perfil', error: error.message });
  }
});

module.exports = router;