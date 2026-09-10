import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const educationDB = {
  "PRN-2026-ENG-042": {
    firstName: "Aarav",
    lastName: "Sharma",
    degree: "B.Tech Computer Engineering",
    institution: "Government College of Engineering",
    passingYear: 2026,
    dob: "2004-05-14",
    status: "ENROLLED"
  },
  "PRN-2024-ART-011": {
    firstName: "Priya",
    lastName: "Deshmukh",
    degree: "B.A. Economics",
    institution: "State University",
    passingYear: 2024,
    dob: "2001-11-20",
    status: "GRADUATED"
  }
};

app.post('/api/v1/education/upsert', (req, res) => {
  const { prn, firstName, lastName, degree, dob, passingYear } = req.body;
  educationDB[prn] = {
    firstName: firstName || "Applicant",
    lastName: lastName || "User",
    degree: degree || "B.Tech",
    institution: "State Accredited Institute",
    passingYear: Number(passingYear) || 2025,
    dob: dob || "2003-01-01",
    status: "VERIFIED"
  };
  return res.json({ status: "SUCCESS", message: `Record stored in Education JSON Registry for ${prn}` });
});

app.get('/api/v1/education/student-profile', (req, res) => {
  const prn = req.query.prn;
  const student = educationDB[prn];

  if (!student) {
    return res.status(404).json({ error: `PRN [${prn}] not found in Education registry` });
  }

  return res.status(200).json({
    registry: "DIRECTORATE_OF_HIGHER_EDUCATION",
    data: student,
    timestamp: new Date().toISOString()
  });
});

const PORT = 4002;
app.listen(PORT, () => console.log(`[EDUCATION DB] Emitting JSON on http://localhost:${PORT}`));
