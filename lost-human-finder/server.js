const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const cors = require('cors');
const path = require('path');

const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

const app = express();
const PORT = process.env.PORT || 5000;

// ── MongoDB Connection ──
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB se connect ho gaya!'))
  .catch(err => { console.error('❌ MongoDB Error:', err.message); process.exit(1); });

// ── Middleware ──
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// ── Static Frontend ──
app.use(express.static(path.join(__dirname, 'public')));


cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "lost-human-finder",
    allowed_formats: ["jpg", "png", "jpeg"]
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }
});
// ── Mongoose Schema ──
const PersonSchema = new mongoose.Schema({
  name:             { type: String, required: true, trim: true },
  age:              { type: Number, min: 0, max: 120 },
  gender:           { type: String, enum: ['Male', 'Female', 'Other', ''] },
  missingDate:      { type: Date },
  lastSeenLocation: { type: String, trim: true },
  description:      { type: String, trim: true },
  reporterName:     { type: String, required: true, trim: true },
  contactNumber:    { type: String, required: true, trim: true },
  photoUrl:         { type: String, default: null },
  status:           { type: String, enum: ['missing', 'found'], default: 'missing' },
  foundDate:        { type: Date, default: null }
}, { timestamps: true });

// Text search index
PersonSchema.index({ name: 'text', lastSeenLocation: 'text', description: 'text' });

const Person = mongoose.model('Person', PersonSchema);

// ─────────────────────────────────────────
// ── ROUTES ──
// ─────────────────────────────────────────

// GET /api/persons — List + Search + Stats
app.get('/api/persons', async (req, res) => {
  try {
    const { q, status, gender, limit } = req.query;
    const filter = {};

    if (q && q.trim()) {
      filter.$or = [
        { name: { $regex: q.trim(), $options: 'i' } },
        { lastSeenLocation: { $regex: q.trim(), $options: 'i' } },
        { description: { $regex: q.trim(), $options: 'i' } },
        { reporterName: { $regex: q.trim(), $options: 'i' } }
      ];
    }
    if (status) filter.status = status;
    if (gender) filter.gender = gender;

    const persons = await Person.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit) || 100);

    // Stats (total, missing, found)
    const [total, missing, found] = await Promise.all([
      Person.countDocuments(),
      Person.countDocuments({ status: 'missing' }),
      Person.countDocuments({ status: 'found' })
    ]);

    res.json({ success: true, persons, stats: { total, missing, found } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/persons/:id — Single record
app.get('/api/persons/:id', async (req, res) => {
  try {
    const person = await Person.findById(req.params.id);
    if (!person) return res.status(404).json({ success: false, message: 'Record nahi mila' });
    res.json(person);
  } catch (err) {
    res.status(400).json({ success: false, message: 'Invalid ID' });
  }
});

// POST /api/persons — New report
app.post('/api/persons', upload.single('photo'), async (req, res) => {
  try {
    const { name, age, gender, missingDate, lastSeenLocation, description, reporterName, contactNumber } = req.body;

    if (!name || !reporterName || !contactNumber) {
      return res.status(400).json({ success: false, message: 'Naam, reporter aur contact zaroori hain' });
    }

    const person = new Person({
      name,
      age: age ? parseInt(age) : undefined,
      gender: gender || '',
      missingDate: missingDate ? new Date(missingDate) : undefined,
      lastSeenLocation,
      description,
      reporterName,
      contactNumber,
      photoUrl: req.file ? req.file.secure_url : null
    });

    await person.save();
    res.status(201).json({ success: true, message: 'Report submit ho gayi!', person });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/persons/:id/found — Mark as Found (Admin Only)
app.patch('/api/persons/:id/found', async (req, res) => {
  try {

    const { password } = req.body;

    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(403).json({
        success: false,
        message: 'Access Denied - Wrong Password'
      });
    }

    const person = await Person.findByIdAndUpdate(
      req.params.id,
      { status: 'found', foundDate: new Date() },
      { new: true }
    );

    if (!person) {
      return res.status(404).json({
        success: false,
        message: 'Record nahi mila'
      });
    }

    res.json({
      success: true,
      message: 'Found mark ho gaya!',
      person
    });

  } catch (err) {
    res.status(400).json({
      success: false,
      message: 'Invalid ID'
    });
  }
});

// DELETE /api/persons/:id — Delete record (Admin Only)
app.delete('/api/persons/:id', async (req, res) => {
  try {

    const { password } = req.body;

    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(403).json({
        success: false,
        message: 'Access Denied - Wrong Password'
      });
    }

    const person = await Person.findByIdAndDelete(req.params.id);

    if (!person) {
      return res.status(404).json({
        success: false,
        message: 'Record nahi mila'
      });
    }

    res.json({
      success: true,
      message: 'Record delete ho gaya'
    });

  } catch (err) {
    res.status(400).json({
      success: false,
      message: 'Invalid ID'
    });
  }
});

// Fallback: Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start Server ──
app.listen(PORT, () => {
  console.log(`🚀 Server chal raha hai: http://localhost:${PORT}`);
  console.log(`📂 Frontend: http://localhost:${PORT}`);
  console.log(`🔌 API: http://localhost:${PORT}/api/persons`);
});