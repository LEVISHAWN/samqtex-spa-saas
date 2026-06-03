import db from './src/db.js';
import bcrypt from 'bcryptjs';

async function seed() {
  const hash = bcrypt.hashSync('SamQtex+123', 10);
  try {
     const user = await db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
     if (!user) {
         await db.prepare('INSERT INTO users (username, name, email, password, role) VALUES (?, ?, ?, ?, ?)').run('admin', 'Admin User', 'admin@samqtex.com', hash, 'admin');
         console.log('Admin user seeded successfully. You can now login with admin / SamQtex+123');
     } else {
         await db.prepare('UPDATE users SET password = ? WHERE username = ?').run(hash, 'admin');
         console.log('Admin user already existed. Password has been reset to SamQtex+123');
     }
  } catch (e) {
     console.error('Failed to seed admin:', e);
  }
  process.exit(0);
}
seed();
