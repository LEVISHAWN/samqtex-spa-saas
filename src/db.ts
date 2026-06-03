import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'samqtex',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Helper to execute queries with compatibility for the old 'get' and 'all' patterns
const db = {
  prepare: (sql: string) => {
    return {
      get: async (...params: any[]) => {
        const [rows] = await pool.execute(sql, params);
        return (rows as any[])[0];
      },
      all: async (...params: any[]) => {
        const [rows] = await pool.execute(sql, params);
        return rows as any[];
      },
      run: async (...params: any[]) => {
        const [result] = await pool.execute(sql, params);
        return {
          lastInsertRowid: (result as any).insertId,
          changes: (result as any).affectedRows
        };
      }
    };
  },
  exec: async (sql: string) => {
    // MySQL doesn't support executing multiple statements by default in a single execute call
    // unless multipleStatements: true is set in the pool.
    // We'll split by semicolon for basic initialization if needed, or just run it as is.
    return await pool.query(sql);
  },
  query: async (sql: string, params?: any[]) => {
    const [rows] = await pool.execute(sql, params || []);
    return rows;
  },
  execute: async (sql: string, params?: any[]) => {
    return await pool.execute(sql, params || []);
  }
};

export default db;
