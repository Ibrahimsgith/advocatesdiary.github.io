import os
from flask import Flask, render_template, request, redirect, url_for, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
from werkzeug.utils import secure_filename
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user
from werkzeug.security import generate_password_hash, check_password_hash
import secrets
import logging

# Initialize Flask app
app = Flask(__name__)
app.config['SECRET_KEY'] = secrets.token_hex(16)  # Secure random secret key
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///cases.db'  # Explicit database file
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = os.path.join(app.root_path, 'uploads')
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16 MB file size limit

# Create uploads folder if it doesn't exist
if not os.path.exists(app.config['UPLOAD_FOLDER']):
    os.makedirs(app.config['UPLOAD_FOLDER'])

# Initialize database
db = SQLAlchemy(app)

# Initialize Flask-Login
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

# User model for authentication
class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# Case model
class Case(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    client_name = db.Column(db.String(100), nullable=False)
    case_status = db.Column(db.Text, nullable=False)
    date_created = db.Column(db.DateTime, default=datetime.utcnow)
    case_file = db.Column(db.String(200), nullable=True)
    interim_orders_file = db.Column(db.String(200), nullable=True)

class Proceeding(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    case_id = db.Column(db.Integer, db.ForeignKey('case.id'), nullable=False)
    proceeding_date = db.Column(db.DateTime, nullable=False)
    description = db.Column(db.Text, nullable=False)
    tentative_date = db.Column(db.DateTime, nullable=True)
    case = db.relationship('Case', backref=db.backref('proceedings', lazy=True, cascade="all, delete-orphan"))

# Allowed file extensions
ALLOWED_EXTENSIONS = {'pdf', 'docx', 'txt'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# Serve uploaded files
@app.route('/uploads/<filename>')
@login_required
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# Routes
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        user = User.query.filter_by(username=username).first()
        if user and check_password_hash(user.password_hash, password):
            login_user(user)
            return redirect(url_for('index'))
        return render_template('login.html', error="Invalid credentials")
    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        
        if len(username) < 3 or len(password) < 6:
            return render_template('register.html', error="Username must be at least 3 characters and password at least 6 characters")
        
        if User.query.filter_by(username=username).first():
            return render_template('register.html', error="Username already exists")
        
        new_user = User(username=username, password_hash=generate_password_hash(password))
        try:
            db.session.add(new_user)
            db.session.commit()
            app.logger.info(f"New user registered: {username}")
            return redirect(url_for('login'))
        except Exception as e:
            db.session.rollback()
            return render_template('register.html', error=f"An error occurred: {e}")
    return render_template('register.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))

@app.route('/')
@login_required
def index():
    cases = Case.query.order_by(Case.date_created.desc()).all()
    return render_template('index.html', cases=cases)

@app.route('/add_case', methods=['GET', 'POST'])
@login_required
def add_case():
    if request.method == 'POST':
        client_name = request.form['client_name']
        case_status = request.form['case_status']
        case_file = request.files.get('case_file')
        interim_orders_file = request.files.get('interim_orders_file')
        case_file_filename = None
        interim_orders_filename = None

        if len(client_name) > 100:
            return render_template('add_case.html', error="Client name too long")

        if case_file and case_file.filename and allowed_file(case_file.filename):
            case_file_filename = secure_filename(case_file.filename)
            case_file.save(os.path.join(app.config['UPLOAD_FOLDER'], case_file_filename))
        if interim_orders_file and interim_orders_file.filename and allowed_file(interim_orders_file.filename):
            interim_orders_filename = secure_filename(interim_orders_file.filename)
            interim_orders_file.save(os.path.join(app.config['UPLOAD_FOLDER'], interim_orders_filename))

        new_case = Case(
            client_name=client_name,
            case_status=case_status,
            case_file=case_file_filename,
            interim_orders_file=interim_orders_filename
        )
        try:
            db.session.add(new_case)
            db.session.commit()
            app.logger.info(f"Case added: {client_name}")
            return redirect(url_for('index'))
        except Exception as e:
            db.session.rollback()
            return render_template('add_case.html', error=f"An error occurred: {e}")
    return render_template('add_case.html')

@app.route('/edit_case/<int:case_id>', methods=['GET', 'POST'])
@login_required
def edit_case(case_id):
    case = Case.query.get_or_404(case_id)
    if request.method == 'POST':
        case.client_name = request.form['client_name']
        case.case_status = request.form['case_status']
        case_file = request.files.get('case_file')
        interim_orders_file = request.files.get('interim_orders_file')

        if len(case.client_name) > 100:
            return render_template('edit_case.html', case=case, error="Client name too long")

        if case_file and case_file.filename and allowed_file(case_file.filename):
            filename = secure_filename(case_file.filename)
            case_file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
            case.case_file = filename
        if interim_orders_file and interim_orders_file.filename and allowed_file(interim_orders_file.filename):
            filename = secure_filename(interim_orders_file.filename)
            interim_orders_file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
            case.interim_orders_file = filename

        try:
            db.session.commit()
            app.logger.info(f"Case updated: {case.client_name}")
            return redirect(url_for('index'))
        except Exception as e:
            db.session.rollback()
            return render_template('edit_case.html', case=case, error=f"An error occurred: {e}")
    return render_template('edit_case.html', case=case)

@app.route('/delete_case/<int:case_id>')
@login_required
def delete_case(case_id):
    case = Case.query.get_or_404(case_id)
    try:
        db.session.delete(case)
        db.session.commit()
        app.logger.info(f"Case deleted: {case.client_name}")
        return redirect(url_for('index'))
    except Exception as e:
        db.session.rollback()
        return f"An error occurred: {e}"

@app.route('/case/<int:case_id>')
@login_required
def view_case(case_id):
    case = Case.query.get_or_404(case_id)
    return render_template('view_case.html', case=case)

@app.route('/add_proceeding/<int:case_id>', methods=['GET', 'POST'])
@login_required
def add_proceeding(case_id):
    case = Case.query.get_or_404(case_id)
    if request.method == 'POST':
        proceeding_date_str = request.form['proceeding_date']
        description = request.form['description']
        tentative_date_str = request.form.get('tentative_date', '').strip()

        try:
            proceeding_date = datetime.strptime(proceeding_date_str.strip(), '%Y-%m-%d')
        except ValueError:
            return render_template('add_proceeding.html', case=case, error="Invalid proceeding date format. Please use YYYY-MM-DD")

        if tentative_date_str:
            try:
                tentative_date = datetime.strptime(tentative_date_str.strip(), '%Y-%m-%d')
            except ValueError:
                return render_template('add_proceeding.html', case=case, error="Invalid tentative date format. Please use YYYY-MM-DD")
        else:
            tentative_date = None

        new_proceeding = Proceeding(
            case_id=case_id,
            proceeding_date=proceeding_date,
            description=description,
            tentative_date=tentative_date
        )
        try:
            db.session.add(new_proceeding)
            db.session.commit()
            app.logger.info(f"Proceeding added for case ID: {case_id}")
            return redirect(url_for('index'))
        except Exception as e:
            db.session.rollback()
            return render_template('add_proceeding.html', case=case, error=f"An error occurred: {e}")
    return render_template('add_proceeding.html', case=case)

@app.route('/edit_proceeding/<int:proceeding_id>', methods=['GET', 'POST'])
@login_required
def edit_proceeding(proceeding_id):
    proceeding = Proceeding.query.get_or_404(proceeding_id)
    if request.method == 'POST':
        proceeding_date_str = request.form['proceeding_date']
        description = request.form['description']
        tentative_date_str = request.form.get('tentative_date', '').strip()

        try:
            proceeding.proceeding_date = datetime.strptime(proceeding_date_str.strip(), '%Y-%m-%d')
        except ValueError:
            return render_template('edit_proceeding.html', proceeding=proceeding, error="Invalid proceeding date format. Please use YYYY-MM-DD")

        if tentative_date_str:
            try:
                proceeding.tentative_date = datetime.strptime(tentative_date_str.strip(), '%Y-%m-%d')
            except ValueError:
                return render_template('edit_proceeding.html', proceeding=proceeding, error="Invalid tentative date format. Please use YYYY-MM-DD")
        else:
            proceeding.tentative_date = None

        proceeding.description = description
        try:
            db.session.commit()
            app.logger.info(f"Proceeding updated: {proceeding_id}")
            return redirect(url_for('index'))
        except Exception as e:
            db.session.rollback()
            return render_template('edit_proceeding.html', proceeding=proceeding, error=f"An error occurred: {e}")
    return render_template('edit_proceeding.html', proceeding=proceeding)

@app.route('/delete_proceeding/<int:proceeding_id>')
@login_required
def delete_proceeding(proceeding_id):
    proceeding = Proceeding.query.get_or_404(proceeding_id)
    try:
        db.session.delete(proceeding)
        db.session.commit()
        app.logger.info(f"Proceeding deleted: {proceeding_id}")
        return redirect(url_for('index'))
    except Exception as e:
        db.session.rollback()
        return f"An error occurred: {e}"

# Initialize database with default user
def init_db():
    with app.app_context():
        db.create_all()
        if not User.query.filter_by(username='admin').first():
            admin = User(username='admin', password_hash=generate_password_hash('password'))
            db.session.add(admin)
            db.session.commit()
            app.logger.info("Default admin user created")

if __name__ == '__main__':
    logging.basicConfig(filename='app.log', level=logging.INFO)
    init_db()  # Initialize database and default user
    app.run(host="0.0.0.0", port=5000, debug=False)  # Debug=False for security