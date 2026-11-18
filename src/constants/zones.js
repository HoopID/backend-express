// Zonas del mapa de tiro. Deben coincidir con el CHECK de shooting_session_spots
// (infraestructura/init.sql) y con frontend-vue/src/utils/shootingStats.js.
const SHOT_ZONES = [
  'corner_left',
  'corner_right',
  'wing_left',
  'wing_right',
  'top_key',
  'elbow_left',
  'elbow_right',
  'paint',
  'free_throw',
  'mid_left',
  'mid_right',
  'mid_center',
];

module.exports = { SHOT_ZONES };
