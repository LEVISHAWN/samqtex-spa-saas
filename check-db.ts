import db from './src/db.js';

async function checkDb() {
  try {
    const tables = await db.query('SHOW TABLES');
    console.log('Tables in database:', tables);
    const users = await db.prepare('SELECT COUNT(*) as count FROM users').get();
    console.log('User count:', users);
  } catch (error) {
    console.error('Database check failed:', error.message);
  }
  process.exit();
}

checkDb();
