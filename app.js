const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const session = require('express-session');
const Sequelize = require('sequelize');
const { DataTypes } = Sequelize;
const bcrypt = require('bcrypt');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const multer = require('multer');
const morgan = require('morgan');

// Initialize Express app
const app = express();

// Middleware for logging, parsing, and sessions
app.use(morgan('combined'));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(session({
  secret: crypto.randomBytes(16).toString('hex'),
  resave: false,
  saveUninitialized: false
}));

// Initialize Passport for authentication
app.use(passport.initialize());
app.use(passport.session());

// Set view engine to EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Create uploads folder if it doesn't exist and serve static files
const uploadFolder = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadFolder)) {
  fs.mkdirSync(uploadFolder);
}
app.use('/uploads', express.static(uploadFolder));

// Initialize Sequelize with SQLite
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: 'cases.db'
});

// Define the User model
const User = sequelize.define('User', {
  username: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false
  },
  passwordHash: {
    type: DataTypes.STRING,
    allowNull: false
  }
});

// Define the Case model
const Case = sequelize.define('Case', {
  clientName: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: { len: [0, 100] }
  },
  caseStatus: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  dateCreated: {
    type: DataTypes.DATE,
    defaultValue: Sequelize.NOW
  },
  caseFile: {
    type: DataTypes.STRING,
    allowNull: true
  },
  interimOrdersFile: {
    type: DataTypes.STRING,
    allowNull: true
  }
});

// Define the Proceeding model
const Proceeding = sequelize.define('Proceeding', {
  proceedingDate: {
    type: DataTypes.DATE,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  tentativeDate: {
    type: DataTypes.DATE,
    allowNull: true
  }
});

// Define associations: A Case has many Proceedings.
Case.hasMany(Proceeding, { onDelete: 'CASCADE' });
Proceeding.belongsTo(Case);

// Passport local strategy for authentication
passport.use(new LocalStrategy(
  async (username, password, done) => {
    try {
      const user = await User.findOne({ where: { username } });
      if (!user) {
        return done(null, false, { message: 'Invalid credentials' });
      }
      const match = await bcrypt.compare(password, user.passwordHash);
      if (match) {
        return done(null, user);
      }
      return done(null, false, { message: 'Invalid credentials' });
    } catch (err) {
      return done(err);
    }
  }
));

passport.serializeUser((user, done) => {
  done(null, user.id);
});
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findByPk(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// Middleware to protect routes
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/login');
}

// Allowed file extensions for uploads
const allowedExtensions = ['pdf', 'docx', 'txt'];

// Multer storage and file filter configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadFolder);
  },
  filename: function (req, file, cb) {
    // Secure the filename (for production you might add more safety checks)
    cb(null, file.originalname);
  }
});

const fileFilter = (req, file, cb) => {
  const ext = file.originalname.split('.').pop().toLowerCase();
  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('File type not allowed'));
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 16 * 1024 * 1024 }  // 16 MB limit
});

// Routes

// Login routes
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', passport.authenticate('local', {
  successRedirect: '/',
  failureRedirect: '/login?error=Invalid credentials'
}));

// Register routes
app.get('/register', (req, res) => {
  res.render('register', { error: null });
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (username.length < 3 || password.length < 6) {
    return res.render('register', { error: 'Username must be at least 3 characters and password at least 6 characters' });
  }
  try {
    const existingUser = await User.findOne({ where: { username } });
    if (existingUser) {
      return res.render('register', { error: 'Username already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await User.create({ username, passwordHash: hashedPassword });
    console.log(`New user registered: ${username}`);
    res.redirect('/login');
  } catch (err) {
    res.render('register', { error: 'An error occurred: ' + err.message });
  }
});

// Logout route
app.get('/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/login');
  });
});

// Index: List all cases
app.get('/', ensureAuthenticated, async (req, res) => {
  try {
    const cases = await Case.findAll({ order: [['dateCreated', 'DESC']] });
    res.render('index', { cases });
  } catch (err) {
    res.send('An error occurred: ' + err.message);
  }
});

// Add a new case
app.get('/add_case', ensureAuthenticated, (req, res) => {
  res.render('add_case', { error: null });
});

app.post('/add_case', ensureAuthenticated, upload.fields([{ name: 'case_file' }, { name: 'interim_orders_file' }]), async (req, res) => {
  const { client_name, case_status } = req.body;
  let caseFile = null;
  let interimOrdersFile = null;

  if (client_name.length > 100) {
    return res.render('add_case', { error: 'Client name too long' });
  }
  if (req.files['case_file'] && req.files['case_file'][0]) {
    caseFile = req.files['case_file'][0].filename;
  }
  if (req.files['interim_orders_file'] && req.files['interim_orders_file'][0]) {
    interimOrdersFile = req.files['interim_orders_file'][0].filename;
  }
  try {
    await Case.create({
      clientName: client_name,
      caseStatus: case_status,
      caseFile: caseFile,
      interimOrdersFile: interimOrdersFile
    });
    console.log(`Case added: ${client_name}`);
    res.redirect('/');
  } catch (err) {
    res.render('add_case', { error: 'An error occurred: ' + err.message });
  }
});

// Edit a case
app.get('/edit_case/:case_id', ensureAuthenticated, async (req, res) => {
  try {
    const caseInstance = await Case.findByPk(req.params.case_id);
    if (!caseInstance) return res.send('Case not found');
    res.render('edit_case', { case: caseInstance, error: null });
  } catch (err) {
    res.send('An error occurred: ' + err.message);
  }
});

app.post('/edit_case/:case_id', ensureAuthenticated, upload.fields([{ name: 'case_file' }, { name: 'interim_orders_file' }]), async (req, res) => {
  try {
    const caseInstance = await Case.findByPk(req.params.case_id);
    if (!caseInstance) return res.send('Case not found');

    const { client_name, case_status } = req.body;
    if (client_name.length > 100) {
      return res.render('edit_case', { case: caseInstance, error: 'Client name too long' });
    }
    caseInstance.clientName = client_name;
    caseInstance.caseStatus = case_status;

    if (req.files['case_file'] && req.files['case_file'][0]) {
      caseInstance.caseFile = req.files['case_file'][0].filename;
    }
    if (req.files['interim_orders_file'] && req.files['interim_orders_file'][0]) {
      caseInstance.interimOrdersFile = req.files['interim_orders_file'][0].filename;
    }
    await caseInstance.save();
    console.log(`Case updated: ${client_name}`);
    res.redirect('/');
  } catch (err) {
    res.render('edit_case', { case: req.body, error: 'An error occurred: ' + err.message });
  }
});

// Delete a case
app.get('/delete_case/:case_id', ensureAuthenticated, async (req, res) => {
  try {
    const caseInstance = await Case.findByPk(req.params.case_id);
    if (!caseInstance) return res.send('Case not found');
    await caseInstance.destroy();
    console.log(`Case deleted: ${caseInstance.clientName}`);
    res.redirect('/');
  } catch (err) {
    res.send('An error occurred: ' + err.message);
  }
});

// View a single case (with its proceedings)
app.get('/case/:case_id', ensureAuthenticated, async (req, res) => {
  try {
    const caseInstance = await Case.findByPk(req.params.case_id, { include: Proceeding });
    if (!caseInstance) return res.send('Case not found');
    res.render('view_case', { case: caseInstance });
  } catch (err) {
    res.send('An error occurred: ' + err.message);
  }
});

// Add a proceeding to a case
app.get('/add_proceeding/:case_id', ensureAuthenticated, async (req, res) => {
  try {
    const caseInstance = await Case.findByPk(req.params.case_id);
    if (!caseInstance) return res.send('Case not found');
    res.render('add_proceeding', { case: caseInstance, error: null });
  } catch (err) {
    res.send('An error occurred: ' + err.message);
  }
});

app.post('/add_proceeding/:case_id', ensureAuthenticated, async (req, res) => {
  try {
    const caseInstance = await Case.findByPk(req.params.case_id);
    if (!caseInstance) return res.send('Case not found');

    const { proceeding_date, description, tentative_date } = req.body;
    const proceedingDateObj = new Date(proceeding_date);
    if (isNaN(proceedingDateObj.getTime())) {
      return res.render('add_proceeding', { case: caseInstance, error: 'Invalid proceeding date format. Please use YYYY-MM-DD' });
    }
    let tentativeDateObj = null;
    if (tentative_date && tentative_date.trim() !== '') {
      tentativeDateObj = new Date(tentative_date);
      if (isNaN(tentativeDateObj.getTime())) {
        return res.render('add_proceeding', { case: caseInstance, error: 'Invalid tentative date format. Please use YYYY-MM-DD' });
      }
    }
    await Proceeding.create({
      proceedingDate: proceedingDateObj,
      description,
      tentativeDate: tentativeDateObj,
      CaseId: caseInstance.id
    });
    console.log(`Proceeding added for case ID: ${caseInstance.id}`);
    res.redirect('/');
  } catch (err) {
    res.render('add_proceeding', { case: req.body, error: 'An error occurred: ' + err.message });
  }
});

// Edit a proceeding
app.get('/edit_proceeding/:proceeding_id', ensureAuthenticated, async (req, res) => {
  try {
    const proceeding = await Proceeding.findByPk(req.params.proceeding_id);
    if (!proceeding) return res.send('Proceeding not found');
    res.render('edit_proceeding', { proceeding, error: null });
  } catch (err) {
    res.send('An error occurred: ' + err.message);
  }
});

app.post('/edit_proceeding/:proceeding_id', ensureAuthenticated, async (req, res) => {
  try {
    const proceeding = await Proceeding.findByPk(req.params.proceeding_id);
    if (!proceeding) return res.send('Proceeding not found');

    const { proceeding_date, description, tentative_date } = req.body;
    const proceedingDateObj = new Date(proceeding_date);
    if (isNaN(proceedingDateObj.getTime())) {
      return res.render('edit_proceeding', { proceeding, error: 'Invalid proceeding date format. Please use YYYY-MM-DD' });
    }
    let tentativeDateObj = null;
    if (tentative_date && tentative_date.trim() !== '') {
      tentativeDateObj = new Date(tentative_date);
      if (isNaN(tentativeDateObj.getTime())) {
        return res.render('edit_proceeding', { proceeding, error: 'Invalid tentative date format. Please use YYYY-MM-DD' });
      }
    }
    proceeding.proceedingDate = proceedingDateObj;
    proceeding.description = description;
    proceeding.tentativeDate = tentativeDateObj;
    await proceeding.save();
    console.log(`Proceeding updated: ${req.params.proceeding_id}`);
    res.redirect('/');
  } catch (err) {
    res.render('edit_proceeding', { proceeding: req.body, error: 'An error occurred: ' + err.message });
  }
});

// Delete a proceeding
app.get('/delete_proceeding/:proceeding_id', ensureAuthenticated, async (req, res) => {
  try {
    const proceeding = await Proceeding.findByPk(req.params.proceeding_id);
    if (!proceeding) return res.send('Proceeding not found');
    await proceeding.destroy();
    console.log(`Proceeding deleted: ${req.params.proceeding_id}`);
    res.redirect('/');
  } catch (err) {
    res.send('An error occurred: ' + err.message);
  }
});

// Initialize database and create default admin user
sequelize.sync().then(async () => {
  const adminUser = await User.findOne({ where: { username: 'admin' } });
  if (!adminUser) {
    const hashedPassword = await bcrypt.hash('password', 10);
    await User.create({ username: 'admin', passwordHash: hashedPassword });
    console.log("Default admin user created");
  }
  const port = process.env.PORT || 5000;
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}).catch(err => {
  console.error('Unable to connect to the database:', err);
});
