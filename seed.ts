import db from './src/db.js';
import bcrypt from 'bcryptjs';

async function seed() {
  try {
    console.log('Starting seeding...');

    // Clear existing data (optional, but good for clean seed)
    await db.query('DELETE FROM service_options');
    await db.query('DELETE FROM services');
    await db.query('DELETE FROM users');

    // Create Admin User
    const adminHash = bcrypt.hashSync('SamQtex+123', 10);
    await db.prepare('INSERT INTO users (username, name, email, phone, password, role) VALUES (?, ?, ?, ?, ?, ?)')
      .run('admin', 'Admin User', 'admin@samqtex.com', '0700000000', adminHash, 'admin');
    console.log('Admin user created (username: admin, password: SamQtex+123)');

    // Create Worker User
    const workerHash = bcrypt.hashSync('worker123', 10);
    await db.prepare('INSERT INTO users (username, name, email, phone, password, role) VALUES (?, ?, ?, ?, ?, ?)')
      .run('jane', 'Jane Doe', 'jane@samqtex.com', '0711111111', workerHash, 'worker');
    console.log('Worker user created (username: jane, password: worker123)');

    // Create Services
    const demoServices = [
      { category: 'Facial', name: 'Hydra Facial', description: 'Deep cleansing and hydration', price: 80, duration: 45 },
      { category: 'Nails', name: 'Gel Manicure', description: 'Long-lasting nail polish', price: 45, duration: 60 },
      { category: 'Massage', name: 'Deep Tissue Massage', description: 'Intense muscle relief', price: 120, duration: 90 },
      { category: 'Massage', name: 'Swedish Massage', description: 'Relaxing full body massage', price: 90, duration: 60 },
      { category: 'Nails', name: 'Acrylic Nails', description: 'Nail extensions', price: 65, duration: 90 }
    ];

    for (const s of demoServices) {
      const result = await db.prepare('INSERT INTO services (category, name, description, price, duration_minutes) VALUES (?, ?, ?, ?, ?)')
        .run(s.category, s.name, s.description, s.price, s.duration);
      console.log(`Service created: ${s.name}`);
      
      // Add default options for some services
      if (s.category === 'Nails') {
        await db.prepare('INSERT INTO service_options (service_id, option_name, option_values) VALUES (?, ?, ?)')
          .run(result.lastInsertRowid, 'Color', JSON.stringify(['Classic Red', 'Midnight Blue', 'Soft Pink', 'Pearl White']));
      }
    }

    console.log('Seeding completed successfully!');
  } catch (error) {
    console.error('Seeding failed:', error);
  } finally {
    process.exit();
  }
}

seed();
