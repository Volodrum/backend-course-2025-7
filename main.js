require('dotenv').config();

const { program } = require('commander');
const express = require('express'); // Підключаємо Express
const fs = require('fs');
const path = require('path');
const formidable = require('formidable');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express'); // UI для документації

// --- 1. Налаштування Commander ---
program
  .requiredOption('-H, --host <address>', 'Адреса сервера')
  .requiredOption('-p, --port <number>', 'Порт сервера')
  .requiredOption('-c, --cache <path>', 'Шлях до директорії з кешем');

program.parse(process.argv);
const options = program.opts();

// --- Підготовка кешу ---
const cachePath = path.resolve(options.cache);
if (!fs.existsSync(cachePath)) {
  fs.mkdirSync(cachePath, { recursive: true });
}
const dbFile = path.join(cachePath, 'inventory.json');

// --- База даних ---
function readDb() {
  if (!fs.existsSync(dbFile)) return [];
  const data = fs.readFileSync(dbFile, 'utf8');
  return data ? JSON.parse(data) : [];
}

function writeDb(data) {
  fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
}

// --- 4. Налаштування Express ---
const app = express();

// Middleware для парсингу JSON та URL-encoded даних (замість ручного збору chunk'ів)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- 5. Налаштування Swagger ---
const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Inventory API',
    version: '1.0.0',
    description: 'API для управління інвентаризацією (Express Version)',
  },
  servers: [
    { 
      url: `http://localhost:${options.port}`, 
      description: 'Local server' 
    }
  ],
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

const swaggerSpec = swaggerJsdoc({
  definition: swaggerDocument,
  apis: [],
});

// Підключаємо Swagger UI за адресою /docs
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// --- Маршрути (Routes) ---

// Статичні файли (форми)
app.get('/RegisterForm.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'RegisterForm.html'));
});

app.get('/SearchForm.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'SearchForm.html'));
});

// GET /inventory
app.get('/inventory', (req, res) => {
  const items = readDb();
  res.json(items);
});

// POST /register (Multipart/form-data)
app.post('/register', (req, res, next) => {
  const form = new formidable.IncomingForm({
    uploadDir: cachePath,
    keepExtensions: true,
    allowEmptyFiles: true,
    minFileSize: 0
  });

  form.parse(req, (err, fields, files) => {
    if (err) {
        return next(err); // Передаємо помилку Express
    }
    const name = Array.isArray(fields.inventory_name) ? fields.inventory_name[0] : fields.inventory_name;
    const description = Array.isArray(fields.description) ? fields.description[0] : fields.description;
    const photoFile = files.photo ? (Array.isArray(files.photo) ? files.photo[0] : files.photo) : null;

    if (!name) return res.status(400).send('Bad Request: name required');

    let photoName = null;
    if (photoFile && photoFile.size > 0) {
        photoName = path.basename(photoFile.filepath);
    } else {
        // Якщо файл пустий (розмір 0), видаляємо створений пустий temp-файл
        if (photoFile) {
            try { fs.unlinkSync(photoFile.filepath); } catch(e) {}
        }
    }

    const items = readDb();
    const newItem = {
      id: Date.now().toString(),
      name: name,
      description: description || '',
      photo: photoName
    };

    items.push(newItem);
    writeDb(items);
    res.status(201).send(`Created! ID: ${newItem.id}`);
  });
});

// POST /search (x-www-form-urlencoded)
app.post('/search', (req, res) => {
  // Express автоматично розпарсив тіло в req.body завдяки app.use(express.urlencoded)
  const { id, includePhoto } = req.body;
  const showPhoto = includePhoto === 'on';

  const items = readDb();
  const item = items.find(i => i.id === id);

  if (item) {
    const responseData = { ...item };

    if (!showPhoto) {
      delete responseData.photo;
    }
    res.json(responseData);
  } else {
    res.status(404).send('Not Found');
  }
});

// Робота з ID (/inventory/:id)
app.route('/inventory/:id')
  .get((req, res) => {
    const items = readDb();
    const item = items.find(i => i.id === req.params.id);
    if (item) res.json(item);
    else res.status(404).send('Not Found');
  })
  .put((req, res) => {
    const items = readDb();
    const index = items.findIndex(i => i.id === req.params.id);
    if (index === -1) return res.status(404).send('Not Found');

    // Express автоматично розпарсив JSON в req.body
    const updates = req.body;
    if (updates.name) items[index].name = updates.name;
    if (updates.description) items[index].description = updates.description;
    
    writeDb(items);
    res.send('Updated');
  })
  .delete((req, res) => {
    const items = readDb();
    const index = items.findIndex(i => i.id === req.params.id);
    if (index === -1) return res.status(404).send('Not Found');

    if (items[index].photo) {
      try { fs.unlinkSync(path.join(cachePath, items[index].photo)); } catch(e){}
    }
    items.splice(index, 1);
    writeDb(items);
    res.send('Deleted');
  });

// Фото (/inventory/:id/photo)
app.get('/inventory/:id/photo', (req, res) => {
  const items = readDb();
  const item = items.find(i => i.id === req.params.id);
  
  if (item && item.photo) {
    const photoPath = path.join(cachePath, item.photo);
    if (fs.existsSync(photoPath)) {
      res.sendFile(photoPath); // Express має зручний метод sendFile
    } else {
      res.status(404).send('File missing');
    }
  } else {
    res.status(404).send('No photo');
  }
});

// Запуск сервера
app.listen(options.port, options.host, () => {
  console.log(`Express Server running at http://${options.host}:${options.port}`);
  console.log(`Docs available at http://${options.host}:${options.port}/docs`);
});