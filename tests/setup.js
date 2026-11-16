// Variables de entorno para los tests (no dependen de un .env ni de una base de datos real)
process.env.JWT_SECRET = 'secreto-solo-para-tests';
process.env.NODE_ENV = 'test';
process.env.DOTENV_CONFIG_QUIET = 'true';
