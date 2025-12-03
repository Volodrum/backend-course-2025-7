require('dotenv').config();

const { program } = require('commander');
const express = require('express');
const fs = require('fs');
const path = require('path');
const formidable = require('formidable');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const { Pool } = require('pg'); // 1. Підключаємо клієнт для PostgreSQL

// --- Налаштування Commander ---
program
  .option('-H, --host <address>', 'Адреса сервера', process.env.HOST || '0.0.0.0')
  .option('-p, --port <number>', 'Порт сервера', process.env.PORT || '3000')
  .option('-c, --cache <path>', 'Шлях до директорії з кешем', process.env.CACHE_PATH || './cache');

program.parse(process.argv);
const options = program.opts();

// --- Підготовка папки для фото ---
const cachePath = path.resolve(options.cache);
if (!fs.existsSync(cachePath)) {
  fs.mkdirSync(cachePath, { recursive: true });
}

// --- 2. Налаштування з'єднання з БД ---
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Перевірка з'єднання при старті
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Помилка підключення до БД:', err);
  } else {
    console.log('Успішне підключення до БД PostgreSQL');
  }
});

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Swagger (без змін) ---
const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Inventory API',
    version: '1.0.0',
    description: 'API для управління інвентаризацією (PostgreSQL Version)',
  },
  servers: [{ url: `http://localhost:${options.port}`, description: 'Local server' }],
  paths: {
    '/inventory': {
      get: {
        summary: 'Отримати список всіх речей',
        responses: { 200: { description: 'Список речей' } }
      }
    },
    '/register': {
      post: {
        summary: 'Реєстрація нової речі (з фото)',
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  inventory_name: { type: 'string' },
                  description: { type: 'string' },
                  photo: { type: 'string', format: 'binary' }
                }
              }
            }
          }
        },
        responses: { 201: { description: 'Річ створено' } }
      }
    },
    '/search': {
      post: {
        summary: 'Пошук речі за ID',
        requestBody: {
          content: {
            'application/x-www-form-urlencoded': {
              schema: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  includePhoto: { type: 'string' }
                }
              }
            }
          }
        },
        responses: {
          200: { description: 'Річ знайдено' },
          404: { description: 'Річ не знайдено' }
        }
      }
    },
    '/inventory/{id}': {
        get: {
            summary: 'Отримати деталі речі',
            parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
            responses: { 200: { description: 'Деталі речі' } }
        },
        put: {
            summary: 'Оновити річ',
            parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
            requestBody: {
                content: {
                    'application/json': {
                        schema: {
                            type: 'object',
                            properties: { name: { type: 'string' }, description: { type: 'string' } }
                        }
                    }
                }
            },
            responses: { 200: { description: 'Оновлено' } }
        },
        delete: {
            summary: 'Видалити річ',
            parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
            responses: { 200: { description: 'Видалено' } }
        }
    },
    '/inventory/{id}/photo': {
      get: {
        summary: 'Отримати фото',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Зображення' } }
      }
    }
  }
};

const swaggerSpec = swaggerJsdoc({ definition: swaggerDocument, apis: [] });
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// --- Маршрути (Routes) ---

app.get('/RegisterForm.html', (req, res) => res.sendFile(path.join(__dirname, 'RegisterForm.html')));
app.get('/SearchForm.html', (req, res) => res.sendFile(path.join(__dirname, 'SearchForm.html')));

// GET /inventory - Отримати всі записи з БД
app.get('/inventory', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM items ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Database Error');
  }
});

// POST /register
app.post('/register', (req, res, next) => {
  const form = new formidable.IncomingForm({
    uploadDir: cachePath,
    keepExtensions: true,
    allowEmptyFiles: true,
    minFileSize: 0
  });

  form.parse(req, async (err, fields, files) => {
    if (err) return next(err);

    const name = Array.isArray(fields.inventory_name) ? fields.inventory_name[0] : fields.inventory_name;
    const description = Array.isArray(fields.description) ? fields.description[0] : fields.description;
    const photoFile = files.photo ? (Array.isArray(files.photo) ? files.photo[0] : files.photo) : null;

    if (!name) return res.status(400).send('Bad Request: name required');

    let photoName = null;
    if (photoFile && photoFile.size > 0) {
        photoName = path.basename(photoFile.filepath);
    } else if (photoFile) {
        try { fs.unlinkSync(photoFile.filepath); } catch(e) {}
    }

    try {
      // INSERT запит до БД
      const query = 'INSERT INTO items (name, description, photo) VALUES ($1, $2, $3) RETURNING *';
      const values = [name, description || '', photoName];
      const result = await pool.query(query, values);
      
      const newItem = result.rows[0];
      res.status(201).send(`Created! ID: ${newItem.id}`);
    } catch (dbErr) {
      console.error(dbErr);
      res.status(500).send('Database Error');
    }
  });
});

// POST /search
app.post('/search', async (req, res) => {
  const { id, includePhoto } = req.body;
  const showPhoto = includePhoto === 'on';

  try {
    // Пошук за ID в БД
    const result = await pool.query('SELECT * FROM items WHERE id = $1', [id]);
    
    if (result.rows.length > 0) {
      const item = { ...result.rows[0] };
      if (!showPhoto) {
        delete item.photo;
      }
      res.json(item);
    } else {
      res.status(404).send('Not Found');
    }
  } catch (err) {
    // Якщо id не є числом (Postgres викине помилку для integer поля), повертаємо 404
    res.status(404).send('Not Found or Invalid ID');
  }
});

// Робота з ID (/inventory/:id)
app.route('/inventory/:id')
  .get(async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM items WHERE id = $1', [req.params.id]);
      if (result.rows.length > 0) res.json(result.rows[0]);
      else res.status(404).send('Not Found');
    } catch (err) { res.status(500).send('Server Error'); }
  })
  .put(async (req, res) => {
    try {
      const { name, description } = req.body;
      // UPDATE запит (оновлюємо тільки якщо передані нові значення, інакше залишаємо старі - COALESCE)
      // Але для простоти зробимо два кроки або простий UPDATE
      const query = `
        UPDATE items 
        SET name = COALESCE($1, name), description = COALESCE($2, description) 
        WHERE id = $3 
        RETURNING *`;
      const result = await pool.query(query, [name, description, req.params.id]);
      
      if (result.rows.length > 0) res.send('Updated');
      else res.status(404).send('Not Found');
    } catch (err) { res.status(500).send('Server Error'); }
  })
  .delete(async (req, res) => {
    try {
        // Спочатку отримаємо ім'я файлу, щоб видалити його з диска
        const findResult = await pool.query('SELECT photo FROM items WHERE id = $1', [req.params.id]);
        
        if (findResult.rows.length === 0) return res.status(404).send('Not Found');

        const photoName = findResult.rows[0].photo;
        
        // Видаляємо запис з БД
        await pool.query('DELETE FROM items WHERE id = $1', [req.params.id]);

        // Видаляємо файл з диска (якщо він був)
        if (photoName) {
            try { fs.unlinkSync(path.join(cachePath, photoName)); } catch(e){}
        }
        
        res.send('Deleted');
    } catch (err) { 
        console.error(err);
        res.status(500).send('Server Error'); 
    }
  });

// Фото (/inventory/:id/photo)
app.get('/inventory/:id/photo', async (req, res) => {
  try {
    const result = await pool.query('SELECT photo FROM items WHERE id = $1', [req.params.id]);
    
    if (result.rows.length > 0 && result.rows[0].photo) {
      const photoPath = path.join(cachePath, result.rows[0].photo);
      if (fs.existsSync(photoPath)) {
        res.sendFile(photoPath);
      } else {
        res.status(404).send('File missing on disk');
      }
    } else {
      res.status(404).send('No photo in DB');
    }
  } catch (err) { res.status(500).send('Error'); }
});

app.listen(options.port, options.host, () => {
  console.log(`Express Server running at http://${options.host}:${options.port}`);
  console.log(`Docs available at http://${options.host}:${options.port}/docs`);
});