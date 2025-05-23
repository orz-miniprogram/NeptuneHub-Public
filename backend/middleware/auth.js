// auth.js (authentication middleware)
const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
    // Get the Authorization header
    const authHeader = req.header('Authorization');

    // Check if the header exists and starts with 'Bearer '
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authentication token required in "Bearer <token>" format.' });
    }

    // Extract the token by splitting the string
    const token = authHeader.split(' ')[1];

    // Although the check above covers this, an explicit check for an empty token string is also fine
    if (!token) {
         return res.status(401).json({ message: 'Authentication token required.' });
    }


    try {
        // Verify the token using the secret key
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Attach decoded user info to the request object
        req.user = decoded;

        // Call the next middleware (route handler)
        next();
    } catch (err) {
        // If verification fails (invalid signature, expired, etc.)
        console.error('JWT verification error:', err.message); // Log the error server-side
        res.status(401).json({ message: 'Invalid or expired token' });
    }
};

module.exports = auth;