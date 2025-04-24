const express = require('express');
const session = require('express-session');
const Sequelize = require('sequelize');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { User, Case, Proceeding } = require('./models');
const logger = require('fs').createWriteStream('app.log', { flags: 'a' });

const app = express();

// Middleware
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(
  session({
    secret: require('crypto').randomBytes(16).toString('hex'),
    resave: false,
    saveUninitialized: false,
  })
);

// Database Setup
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: 'cases.db',
  logging: false,
});

// File Upload Setup
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
});

const upload = multer({
  storage,
  limits: { fileSize: 16 * 1024 * 1024 }, // 16 MB
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.pdf', '.docx', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  },
});

// Authentication Middleware
const isAuthenticated = (req, res, next) => {
  if (req.session.userId) {
    return next();
  }
  res.redirect('/login');
};

// Routes
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ where: { username } });
  if (user && (await bcrypt.compare(password, user.password_hash))) {
    req.session.userId = user.id;
    logger.write(`User logged in: ${username}\n`);
    return res.redirect('/');
  }
  res.render('login', { error: 'Invalid credentials' });
});

app.get('/register', (req, res) => {
  res.render('register', { error: null });
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (username.length < 3 || password.length < 6) {
    return res.render('register', {
      error: 'Username must be at least 3 characters and password at least 6 characters',
    });
  }
  const existingUser = await User.findOne({ where: { username } });
  if (existingUser) {
    return res.render('register', { error: 'Username already exists' });
  }
  try {
    const password_hash = await bcrypt.hash(password, 10);
    await User.create({ username, password_hash });
    logger.write(`New user registered: ${username}\n`);
    res.redirect('/login');
  } catch (e) {
    res.render('register', { error: `An error occurred: ${e.message}` });
  }
});

app.get('/logout', isAuthenticated, (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.get('/', isAuthenticated, async (req, res) => {
  const cases = await Case.findAll({ order: [['date_created', 'DESC']] });
  res.render('index', { cases });
});

app.get('/add_case', isAuthenticated, (req, res) => {
  res.render('add_case', { error: null });
});

app.post(
  '/add_case',
  isAuthenticated,
  upload.fields([
    { name: 'case_file', maxCount: 1 },
    { name: 'interim_orders_file', maxCount: 1 },
  ]),
  async (req, res) => {
    const { client_name, case_status } = req.body;
    if (client_name.length > 100) {
      return res.render('add_case', { error: 'Client name too long' });
    }
    const case_file = req.files['case_file'] ? req.files['case_file'][0].filename : null;
    const interim_orders_file = req.files['interim_orders_file']
      ? req.files['interim_orders_file'][0].filename
      : null;
    try {
      await Case.create({
        client_name,
        case_status,
        case_file,
        interim_orders_file,
        date_created: new Date(),
      });
      logger.write(`Case added: ${client_name}\n`);
      res.redirect('/');
    } catch (e) {
      res.render('add_case', { error: `An error occurred: ${e.message}` });
    }
  }
);

app.get('/edit_case/:case_id', isAuthenticated, async (req, res) => {
  const caseData = await Case.findByPk(req.params.case_id);
  if (!caseData) return res.status(404).send('Case not found');
  res.render('edit_case', { case: caseData, error: null });
});

app.post(
  '/edit_case/:case_id',
  isAuthenticated,
  upload.fields([
    { name: 'case_file', maxCount: 1 },
    { name: 'interim_orders_file', maxCount: 1 },
  ]),
  async (req, res) => {
    const caseData = await Case.findByPk(req.params.case_id);
    if (!caseData) return res.status(404).send('Case not found');
    const { client_name, case_status } = req.body;
    if (client_name.length > 100) {
      return res.render('edit_case', { case: caseData, error: 'Client name too long' });
    }
    caseData.client_name = client_name;
    caseData.case_status = case_status;
    if (req.files['case_file']) caseData.case_file = req.files['case_file'][0].filename;
    if (req.files['interim_orders_file'])
      caseData.interim_orders_file = req.files['interim_orders_file'][0].filename;
    try {
      await caseData.save();
      logger.write(`Case updated: ${client_name}\n`);
      res.redirect('/');
    } catch (e) {
      res.render('edit_case', { case: caseData, error: `An error occurred: ${e.message}` });
    }
  }
);

app.get('/delete_case/:case_id', isAuthenticated, async (req, res) => {
  const caseData = await Case.findByPk(req.params.case_id);
  if (!caseData) return res.status(404).send('Case not found');
  try {
    await caseData.destroy();
    logger.write(`Case deleted: ${caseData.client_name}\n`);
    res.redirect('/');
  } catch (e) {
    res.status(500).send(`An error occurred: ${e.message}`);
  }
});

app.get('/case/:case_id', isAuthenticated, async (req, res) => {
  const caseData = await Case.findByPk(req.params.case_id, { include: [Proceeding] });
  if (!caseData) return res.status(404).send('Case not found');
  res.render('view_case', { case: caseData });
});

app.get('/add_proceeding/:case_id', isAuthenticated, async (req, res) => {
  const caseData = await Case.findByPk(req.params.case_id);
  if (!caseData) return res.status(404).send('Case not found');
  res.render('add_proceeding', { case: caseData, error: null });
});

app.post('/add_proceeding/:case_id', isAuthenticated, async (req, res) => {
  const caseData = await Case.findByPk(req.params.case_id);
  if (!caseData) return res.status(404).send('Case not found');
  const { proceeding_date, description, tentative_date } = req.body;
  try {
    const proceedingDate = new Date(proceeding_date);
    if (isNaN(proceedingDate.getTime())) {
      throw new Error('Invalid proceeding date format. Please use YYYY-MM-DD');
    }
    const tentativeDate = tentative_date ? new Date(tentative_date) : null;
    if (tentativeDate && isNaN(tentativeDate.getTime())) {
      throw new Error('Invalid tentative date format. Please use YYYY-MM-DD');
    }
    await Proceeding.create({
      case_id: caseData.id,
      proceeding_date: proceedingDate,
      description,
      tentative_date: tentativeDate,
    });
    logger.write(`Proceeding added for case ID: ${caseData.id}\n`);
    res.redirect('/');
  } catch (e) {
    res.render('add_proceeding', { case: caseData, error: `An error occurred: ${e.message}` });
  }
});

app.get('/edit_proceeding/:proceeding_id', isAuthenticated, async (req, res) => {
  const proceeding = await Proceeding.findByPk(req.params.proceeding_id);
  if (!proceeding) return res.status(404).send('Proceeding not found');
  res.render('edit_proceeding', { proceeding, error: null });
});

app.post('/edit_proceeding/:proceeding_id', isAuthenticated, async (req, res) => {
  const proceeding = await Proceeding.findByPk(req.params.proceeding_id);
  if (!proceeding) return res.status(404).send('Proceeding not found');
  const { proceeding_date, description, tentative_date } = req.body;
  try {
    const proceedingDate = new Date(proceeding_date);
    if (isNaN(proceedingDate.getTime())) {
      throw new Error('Invalid proceeding date format. Please use YYYY-MM-DD');
    }
    const tentativeDate = tentative_date ? new Date(tentative_date) : null;
    if (tentativeDate && isNaN(tentativeDate.getTime())) {
      throw new Error('Invalid tentative date format. Please use YYYY-MM-DD');
    }
    proceeding.proceeding_date = proceedingDate;
    proceeding.description = description;
    proceeding.tentative_date = tentativeDate;
    await proceeding.save();
    logger.write(`Proceeding updated: ${proceeding.id}\n`);
    res.redirect('/');
  } catch (e) {
    res.render('edit_proceeding', { proceeding, error: `An error occurred: ${e.message}` });
  }
});

app.get('/delete_proceeding/:proceeding_id', isAuthenticated, async (req, res) => {
  const proceeding = await Proceeding.findByPk(req.params.proceeding_id);
  if (!proceeding) return res.status(404).send('Proceeding not found');
  try {
    await proceeding.destroy();
    logger.write(`Proceeding deleted: ${proceeding.id}\n`);
    res.redirect('/');
  } catch (e) {
    res.status(500).send(`An error occurred: ${e.message}`);
  }
});

// Initialize Database
async function initDb() {
  await sequelize.sync({ force: false });
  const admin = await User.findOne({ where: { username: 'admin' } });
  if (!admin) {
    await User.create({
      username: 'admin',
      password_hash: await bcrypt.hash('password', 10),
    });
    logger.write('Default admin user created\n');
  }
}

// Start Server
initDb().then(() => {
  app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://localhost:5000');
  });
});