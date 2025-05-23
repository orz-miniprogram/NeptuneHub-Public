require('dotenv').config({ path: '.env' });
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const path = require('path');
const server = http.createServer(app);
const io = socketIO(server);
const authenticateToken = require('./middleware/auth');


app.use(cors());
// Apply JSON body parser globally for most routes
// IMPORTANT: This must come AFTER any route-specific raw/xml parsers
app.use(express.json());
// If you need URL-encoded data, also add:
// app.use(express.urlencoded({ extended: true }));

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log('MongoDB connected'))
.catch(err => console.log(err));

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);
    
    // Example: Listen for a message from the client
    socket.on('sendMessage', (data) => {
        console.log('Message received:', data);
        // Emit message to specific room or broadcast
        io.emit('receiveMessage', data);
    });
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

app.get('/', (req, res) => {
    res.send('Neptune Backend with MongoDB Running!');
});

const uploadsPath = path.join(__dirname, 'uploads'); // Path to the uploads directory
console.log('Serving static files from:', uploadsPath);
app.use('/uploads', express.static(uploadsPath)); // Configure Express to serve files under the '/uploads' URL path

const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// --- Apply GLOBAL authentication middleware ---
// All routes defined or mounted *AFTER* this line will require a valid token.
// IMPORTANT: Ensure any routes defined BEFORE this line are genuinely public.
app.use(authenticateToken); // <<< GLOBAL AUTH MIDDLEWARE APPLIED HERE

const resourceRoutes = require('./routes/resource');
app.use('/api/resource', resourceRoutes);

const paymentRoutes = require('./routes/payment');
// Note: The notification endpoint needs to be publicly accessible by WeChat Pay servers
// Ensure your middleware setup doesn't block it if applied globally.
app.use('/api/payment', paymentRoutes); // <<<< Mount them under /api/payment

const matchRoutes = require('./routes/match');
app.use('/api/match', matchRoutes);

const errandRoutes = require('./routes/errand');
app.use('/api/errand', errandRoutes);

const userRoutes = require('./routes/user'); // <<<< Require the new user routes
app.use('/api/user', userRoutes); // <<<< Mount them under /api/users

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

