const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const session = require('express-session');
const pool = require('./db.js'); 
const path = require('path');

const app = express();


app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../frontend'));


app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 3600000 } 

}));


app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('frontend'));




app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});


app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/inscription.html'));
});
app.post('/register', async (req, res) => {
  const { fname, lname, email, password, dob, gender, role } = req.body;

  try {

    const userExists = await pool.query('SELECT * FROM students WHERE email = $1', [email]);
    if (userExists.rows.length > 0) {
      return res.redirect('/register?error=Email already exists.');
    }


    const hashedPassword = await bcrypt.hash(password, 10);


    if (role === 'student') {
      await pool.query(
        `INSERT INTO students (fname, lname, email, password, dob, gender) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [fname, lname, email, hashedPassword, dob, gender]
      );
    } else if (role === 'teacher') {
      await pool.query(
        `INSERT INTO teachers (fname, lname, email, password, dob, gender) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [fname, lname, email, hashedPassword, dob, gender]
      );
    }

    res.redirect('/login');
  } catch (err) {
    console.error('Error registering user:', err);
    res.status(500).send('Error registering user.');
  }
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/login.html'));
});


app.get('/create-exam', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'teacher') {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, '../frontend/create_exam.html'));
});


app.post('/create-exam', async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'teacher') {
    return res.redirect('/');
  }

  const { examTitle, examDescription, targetAudience, duration } = req.body;
  const teacherId = req.session.user.id;

  try {
    const query = `
      INSERT INTO exams (exam_title, exam_description, target_audience, duration, teacher_id)
      VALUES ($1, $2, $3, $4, $5)
    `;
    await pool.query(query, [examTitle, examDescription, targetAudience, duration, teacherId]);
    res.redirect('/welcome');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error.');
  }
});
app.post('/exam/:examId/delete', async (req, res) => {
  const examId = req.params.examId;

  if (!req.session.user || req.session.user.role !== 'teacher') {
    return res.status(401).send('Unauthorized: Only teachers can delete exams.');
  }

  try {

    await pool.query('DELETE FROM questions WHERE exam_id = $1', [examId]);


    await pool.query('DELETE FROM exams WHERE id = $1', [examId]);

    res.redirect('/welcome');
  } catch (err) {
    console.error('Error deleting exam:', err);
    res.status(500).send('Error deleting exam.');
  }
});
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {

    let user = await pool.query('SELECT * FROM students WHERE email = $1', [email]);
    let role = 'student';  


    if (user.rows.length === 0) {
      user = await pool.query('SELECT * FROM teachers WHERE email = $1', [email]);
      role = 'teacher';  
    }


    if (user.rows.length === 0) {
      return res.redirect('/login?error=Email not found.');
    }


    const validPassword = await bcrypt.compare(password, user.rows[0].password);
    if (!validPassword) {
      return res.redirect('/login?error=Invalid password.');
    }


    req.session.user = {
      id: user.rows[0].id,
      name: user.rows[0].fname,
      email: user.rows[0].email,
      role: role 
    };


    res.redirect('/welcome');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error.');
  }
});
app.get('/profile', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/');
  }

  const { role } = req.session.user; 
  res.render('profile', { user: req.session.user, role }); 
});

app.get('/update-profile', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  res.render('edit_profile', { user: req.session.user });
});


app.post('/update-profile', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  const { fname, lname, dob, gender } = req.body;
  const userId = req.session.user.id;

  try {

    await pool.query(
      'UPDATE students SET fname = $1, lname = $2, dob = $4, gender = $5 WHERE id = $6',
      [fname, lname, dob, gender, userId]
    );


    req.session.user = { ...req.session.user, fname, lname, dob, gender };

    res.redirect('/profile');
  } catch (err) {
    console.error('Error updating profile:', err);
    res.status(500).send('Error updating profile.');
  }
});

app.post('/delete-account', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  const userId = req.session.user.id;

  try {

    await pool.query('DELETE FROM students WHERE id = $1', [userId]);

    req.session.destroy(err => {
      if (err) {
        console.error('Error destroying session:', err);
        return res.status(500).send('Error deleting account.');
      }
      res.redirect('/');
    });
  } catch (err) {
    console.error('Error deleting account:', err);
    res.status(500).send('Error deleting account.');
  }
});
app.get('/welcome', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  const { name, role, id } = req.session.user;

  let exams = [];
  if (role === 'teacher') {
    try {
      const result = await pool.query(`
        SELECT e.id, e.exam_title, e.exam_description, e.duration, e.target_audience,
               json_agg(json_build_object(
                 'id', q.id, -- تأكد من تضمين id هنا
                 'text', q.text,
                 'type', q.type,
                 'duration', q.duration,
                 'score', q.score
               )) AS questions
        FROM exams e
        LEFT JOIN questions q ON e.id = q.exam_id
        WHERE e.teacher_id = $1
        GROUP BY e.id
      `, [id]);
      exams = result.rows;
    } catch (err) {
      console.error(err);
      return res.status(500).send('Error fetching exams');
    }
  }

  res.render('home', {
    name,
    role,
    exams,
    message: null,
    question: null
  });
});


app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.send('Error logging out.');
    res.redirect('/');
  });
});
app.get('/exam/:examId/add-question', async (req, res) => {
  const examId = req.params.examId;

  if (!req.session.user || req.session.user.role !== 'teacher') {
    return res.redirect('/login');
  }

  try {
    const examResult = await pool.query('SELECT * FROM exams WHERE id = $1', [examId]);
    const exam = examResult.rows[0];

    if (!exam) {
      return res.status(404).send('Exam not found');
    }

    const questionsResult = await pool.query('SELECT * FROM questions WHERE exam_id = $1', [examId]);
    const questions = questionsResult.rows;

    res.render('add_question', { exam, questions });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching exam or questions');
  }
});


app.post('/exam/:examId/add-question', async (req, res) => {
  const { type, text, duration, score, correctOptions, options, answer } = req.body;
  const examId = req.params.examId;

  if (!req.session.user || !req.session.user.id) {
    return res.status(401).send("Unauthorized: Please log in.");
  }

  try {
    const result = await pool.query(
      `INSERT INTO questions (exam_id, text, type, duration, score) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [examId, text, type, duration, score]
    );

    const questionId = result.rows[0].id;

    if (type === 'qcm') {
      const corrects = Array.isArray(correctOptions) ? correctOptions : [correctOptions];

      if (!options || options.length < 2) {
        return res.status(400).send("At least two options are required for QCM.");
      }

      for (let i = 0; i < options.length; i++) {
        const isCorrect = corrects.includes((i + 1).toString());
        await pool.query(
          `INSERT INTO qcm_options (question_id, option_text, is_correct)
           VALUES ($1, $2, $3)`,
          [questionId, options[i], isCorrect]
        );
      }
    } else if (type === 'direct') {
      if (!answer) {
        return res.status(400).send("Answer is required for direct questions.");
      }

      await pool.query(
        `INSERT INTO direct_question (question_id, correct_answer)
         VALUES ($1, $2)`,
        [questionId, answer]
      );
    }

    res.redirect('/welcome');
  } catch (err) {
    console.error("Error saving question:", err);
    res.status(500).send("Internal Server Error");
  }
});


app.get('/question/:id/edit', async (req, res) => {
  const questionId = req.params.id;

  try {
    console.log('Fetching question with ID:', questionId);
    const result = await pool.query('SELECT * FROM questions WHERE id = $1', [questionId]);
    const question = result.rows[0];

    if (!question) {
      console.error('Question not found for ID:', questionId);
      return res.status(404).send('Question not found');
    }

    res.render('edit_question', { question });
  } catch (err) {
    console.error('Error fetching question:', err);
    res.status(500).send('Error fetching question');
  }
});

app.post('/question/:id/edit', async (req, res) => {
  const questionId = req.params.id;
  const { text, type, duration, score, examId } = req.body;

  try {
    
    await pool.query(
      `UPDATE questions SET text = $1, type = $2, duration = $3, score = $4 WHERE id = $5`,
      [text, type, duration, score, questionId]
    );


    res.redirect('/welcome');
  } catch (err) {
    console.error('Error updating question:', err);
    res.status(500).send('Error updating question');
  }
});


app.post('/question/:id/delete', async (req, res) => {
  const questionId = req.params.id;

  try {

    await pool.query('DELETE FROM questions WHERE id = $1', [questionId]);


    res.redirect('/welcome');
  } catch (err) {
    console.error('Error deleting question:', err);
    res.status(500).send('Error deleting question');
  }
});


app.listen(5000, () => {
  console.log('Server is running on http://localhost:5000');
});