// ./routes/auth.js
const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const qs = require('qs');
const mongoose = require('mongoose'); // Require mongoose
const authenticateToken = require('../middleware/auth');
const cheerio = require('cheerio'); // Require cheerio for HTML parsing
const { CookieJar } = require('tough-cookie'); // Require tough-cookie

// Make sure your User model is required
const User = require('../models/User'); // Adjust path if your models folder is elsewhere

const router = express.Router();

// Ensure your encryption helper is required
const { encryptPasswordWithSalt } = require('../utils/encryption_helper');

// IMPORTANT: Get your JWT secret securely.
const JWT_SECRET = process.env.JWT_SECRET || 'YOUR_FALLBACK_SECRET';

// External login endpoint
router.post('/external-login', async (req, res) => {
    // Dynamically import wrapper and create client inside the handler
    const { wrapper } = await import('axios-cookiejar-support');
    const cookieJar = new CookieJar();
    const client = wrapper(axios.create({ jar: cookieJar }));

    // Get external student ID and raw password from request body
    const { username: externalStudentId, password: rawPassword } = req.body;

    // >>>>>> 1. Input Validation (Check at the very beginning) <<<<<<<
    if (!externalStudentId || !rawPassword) {
        console.warn('Missing username or password in login request.');
        return res.status(400).json({ message: 'Student ID and password are required.' });
    }

    console.log(`Attempting login for username: ${externalStudentId}`); // Use the correct variable name

    try {
        // >>>>>> 2. TEMPORARY TEST LOGIN LOGIC <<<<<<<
        // If the username is the test user, bypass external authentication
        // REMOVE THIS BLOCK FOR PRODUCTION
        if (externalStudentId === 'testuser') {
            console.log('>>> Test user login detected. Bypassing external authentication. <<<');

            // Find the test user in the database
            // Ensure you have a user document in your DB with username: "testuser"
            const testUser = await User.findOne({ username: 'testuser' });

            if (testUser) {
                console.log('Test user found in DB. Generating token...');
                // Generate JWT token for the test user
                const token = jwt.sign(
                    { userId: testUser._id }, // Payload: Include the user's DB _id
                    JWT_SECRET, // Your JWT secret key
                    { expiresIn: '1d' } // Token expires in 1 day
                );

                // Return success response to the mini-program like a normal login
                console.log('Test login successful. Returning token and user info.');
                return res.status(200).json({
                    message: 'Test login successful', // Optional message
                    token: token, // The generated JWT token
                    user: { // Return necessary user info (adjust fields as needed for your frontend)
                        _id: testUser._id,
                        username: testUser.username, // Should be "testuser"
                        // Add other user properties you need on the frontend here (e.g., displayName, credits, points)
                        // Example: displayName: testUser.displayName,
                        // Example: credits: testUser.credits,
                    }
                });
            } else {
                // Test user not found in DB - indicates a setup issue in your database
                console.error('Test user "testuser" not found in the database! Please create the user in your DB.');
                return res.status(404).json({ message: 'Test user not found in database setup.' });
            }
        }
        // >>>>>> END TEMPORARY TEST LOGIN LOGIC <<<<<<<


        // >>>>>> 3. Standard External Authentication Process (If not test user) <<<<<<<
        // This part runs only if the username is NOT 'testuser'

        const externalLoginUrl = 'https://login.bit.edu.cn/authserver/login';
        console.log('Step 1: Getting external login page...');

        // --- STEP 1: Perform GET request to get login page HTML and cookies ---
        const getResponse = await client.get(externalLoginUrl, {
             // Add headers to mimic browser request if needed for the GET
              headers: {
                 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36', // Example User-Agent
                 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
                 'Accept-Language': 'en-US,en;q=0.9',
                 'Referer': 'https://login.bit.edu.cn/' // Or the actual referring page if different
             },
         });

        // --- STEP 2: Parse HTML to extract dynamic parameters and salt ---
        console.log('Step 2: Parsing HTML for tokens and salt...');
        const $ = cheerio.load(getResponse.data);

        const execution = $('input[name="execution"]').val(); // Get value of input with name="execution"
        const lt = $('input[name="lt"]').val(); // Get value of input with name="lt" (might be needed)
         // Extract other fields you identified as potentially necessary for the POST
         const _eventId = $('input[name="_eventId"]').val() || 'submit'; // Default to 'submit' if not found
         const cllt = $('input[name="cllt"]').val() || 'userNameLogin'; // Default if not found
         const dllt = $('input[name="dllt"]').val(); // dllt might be optional


        // Find the password encryption salt using its ID
        const pwdEncryptSalt = $('#pwdEncryptSalt').val(); // Correct ID based on login.js

         // Check if CAPTCHA elements exist in the HTML using .length
         // This is the corrected check, replacing the unsupported :visible pseudo-class
         const captchaNeeded = $('#captchaDiv').length > 0 || $('#sliderCaptchaDiv').length > 0; // <<-- CORRECTED

         // You would need to scrape the CAPTCHA image source if it's a standard image CAPTCHA
         // const captchaImgSrc = captchaNeeded && $('#captchaImg').attr('src');

        console.log('Extracted Execution:', execution);
        console.log('Extracted LT:', lt);
         console.log('Extracted _eventId:', _eventId);
         console.log('Extracted cllt:', cllt);
         console.log('Extracted dllt:', dllt);
        console.log('Extracted PwdEncryptSalt:', pwdEncryptSalt);
         console.log('Captcha Needed (elements found):', captchaNeeded); // Log based on the corrected check
         // if(captchaImgSrc) console.log('Captcha Image Source:', captchaImgSrc);


        if (!execution || !lt || !pwdEncryptSalt) { // Check essential extracted fields
             console.error('Error: Missing essential form fields or salt from external page.');
              // Optionally log the HTML content here if debugging extraction issues: console.error(getResponse.data);
             return res.status(500).json({ message: 'Failed to get necessary login form data from external site.' });
         }

          if (captchaNeeded) {
             console.warn('CAPTCHA is required for this login attempt (elements found).');
             // Fail if CAPTCHA is needed and you don't have a way to solve/submit it
              return res.status(400).json({ message: 'CAPTCHA is required for external login. Please try again or log in manually on the website.' });
             // If you could solve it, you'd need to get the solution from the frontend request body
             // and include it in the POST request body here.
         }


        // --- STEP 3: Implement Password Encryption ---
        console.log('Step 3: Encrypting password using helper...');
        // Call the encryptPasswordWithSalt function with the raw password and extracted salt
        // Make sure you REMOVE any temporary fixed random values from generateRandomString in encryption_helper.js
        // when using this for actual logins! It should generate random strings each time.
        const encryptedPassword = encryptPasswordWithSalt(rawPassword, pwdEncryptSalt);
        console.log('Encrypted Password (Base64):', encryptedPassword);


        // --- STEP 4: Prepare Parameters for the POST request ---
        const requestBody = {
            username: externalStudentId, // Send the external student ID
            password: encryptedPassword, // Send the encrypted password
            execution: execution, // Send the extracted execution token
            lt: lt, // Send the extracted lt token
            _eventId: _eventId, // Send the event ID ('submit')
            cllt: cllt, // Send the login type ('userNameLogin')
            ...(dllt && { dllt: dllt }), // Include dllt if it was present
            // Include captcha solution if needed and available (requires handling in frontend and here)
            // ...(captchaNeeded && captchaCode && { captcha: captchaCode }),
            // ...(captchaNeeded && sliderCaptchaResponse && { sliderCaptchaResponse: sliderCaptchaResponse }),

            // Add any other required hidden fields you identified in the form
            // Example: rememberMe: 'on', // If there's a remember me checkbox
        };

        console.log('Step 4: Preparing POST request payload...');
         // Log the payload without the actual password value for security
         const loggedRequestBody = { ...requestBody, password: '***REDACTED***' };
         console.log('POST Request Body (qs.stringify):', qs.stringify(loggedRequestBody));


        // --- STEP 5: Perform POST request to log in ---
        console.log('Step 5: Sending POST request to external login endpoint...');
        const postResponse = await client.post(externalLoginUrl, qs.stringify(requestBody), { // Use the client instance with cookie jar
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded', // Important for form submission
                 // Mimic browser headers carefully
                 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36', // Consistent User-Agent
                 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
                 'Accept-Language': 'en-US,en;q=0.9',
                 // Referer should be the login page URL itself for the POST
                'Referer': externalLoginUrl,
                 // Add any other required headers observed in browser's Network tab
            },
            // Important: Set validateStatus to handle 302 redirects and other statuses
            validateStatus: (status) => status >= 200 && status < 400 || status === 401 || status === 500, // Allow 2xx, 3xx, 401, and 500
            maxRedirects: 0, // Do NOT automatically follow redirects (we need to check for the 302 status manually)
        });

        console.log('Step 6: Analyzing POST response...');
        console.log('POST Response Status:', postResponse.status);
        console.log('POST Response Headers:', postResponse.headers);
         // console.log('POST Response Data (Preview):', postResponse.data?.substring(0, 500) + '...'); // Log data if not a redirect


        // --- STEP 7: Handle the response ---
        // If login is successful, the external server should respond with a redirect (302 status)
        if (postResponse.status === 302) {
            const redirectLocation = postResponse.headers.location;
            console.log('External Login Successful! Received 302 Redirect.');
            console.log('Redirecting to:', redirectLocation);

            // --- Find or create the user in your database using the external studentId ---
             let user;
             try {
                 // Use findOneAndUpdate with upsert: true to find by externalStudentId or create if not exists
                 user = await User.findOneAndUpdate(
                     { username: externalStudentId }, // Use username field in your DB to store external student ID
                     { $setOnInsert: {
                         // Set initial properties only if a new document is inserted
                         displayName: `User_${externalStudentId}`, // Default display name
                         credits: 80,
                         points: 0,
                         createdAt: new Date()
                         // Add other default fields for new users
                     } },
                     { upsert: true, new: true, runValidators: true } // upsert=true: create if not found; new=true: return the updated/new document
                 );
                 console.log('User found or created in DB:', user);
             } catch (dbError) {
                 console.error('Database error during user find/create after external login success:', dbError);
                 return res.status(500).json({ message: 'Failed to process user data after external login.' });
             }


            // --- Generate your own token for the mini-program ---
            const miniProgramToken = jwt.sign(
                { _id: user._id, username: user.username }, // Include user _id and username in token payload
                JWT_SECRET, // Your JWT secret key
                { expiresIn: '1d' } // Token expiration time
            );

            // Send success response back to the mini-program with the token and user info
            res.status(200).json({
                message: 'Login successful',
                token: miniProgramToken, // The generated JWT token
                user: { // Return user info needed by the frontend
                    _id: user._id,
                    username: user.username, // external student ID
                    displayName: user.displayName,
                    credits: user.credits,
                    points: user.points,
                    // Include other profile data if stored and needed
                    // addresses: user.addresses,
                    createdAt: user.createdAt
                }
            });

        } else if (postResponse.status === 200) {
            // Received 200 status with HTML body - Typically indicates login failed with error message in HTML
            console.warn('External Login Failed: Received 200 with HTML response.');
            // --- Parse the HTML body to find the error message ---
            const errorPageHtml = postResponse.data;
            const $error = cheerio.load(errorPageHtml);

            // Look for common error indicators in the HTML from the login page structure
            // Based on the login.js and form HTML, look for elements like:
             const errorMessageElement = $error('.form-error') || $error('#showErrorTip'); // Check both selectors
             const externalErrorMessage = errorMessageElement.text() ? errorMessageElement.text().trim() : 'Login failed (unknown reason from external site).';

             console.warn('External Error Message Found in HTML:', externalErrorMessage);

            // Return an appropriate error response to the frontend based on the external message
            // You might need to refine these checks based on actual error messages you observe
             if (externalErrorMessage.includes('密码错误') || externalErrorMessage.includes('用户名') || externalErrorMessage.includes('学号') || externalErrorMessage.includes('账号')) { // Add more patterns for credential errors
                 return res.status(401).json({ message: 'Invalid student ID or password.' });
             } else if (externalErrorMessage.includes('验证码')) { // Check for CAPTCHA errors
                 return res.status(400).json({ message: 'CAPTCHA required or incorrect.' }); // Requires CAPTCHA handling implementation
             }
             else {
                 // For other errors indicated in the HTML (e.g., account locked, system error)
                 return res.status(400).json({ message: externalErrorMessage }); // Return the specific error message from the external site
             }


        } else if (postResponse.status === 401) {
             // Received 401 directly - Invalid credentials (less common for this site's 200 HTML pattern, but handle it)
             console.warn('External Login Failed: Received 401 Status directly.');
             return res.status(401).json({ message: 'Invalid student ID or password.' });

         } else {
            // Handle other unexpected status codes (e.g., 403, 500 from external server)
            console.error('Unexpected status code from external login POST:', postResponse.status);
             // Optionally log the response data for debugging unexpected statuses: console.error('External Response Data:', postResponse.data);
            return res.status(postResponse.status || 500).json({ message: `External server returned unexpected status: ${postResponse.status}. Cannot proceed.` });
        }


    } catch (error) {
        // This catch block handles network errors, errors during the GET request,
        // HTML parsing errors, errors from axios before getting a response,
        // or errors within the test user lookup or encryption helper.
        console.error('Error during external login process (caught):', error.message);

        if (error.response) {
             // If an error response was received from the external server
             console.error('External response STATUS:', error.response.status);
             console.error('External response HEADERS:', error.response.headers);
              // Log external response data for debugging if available
              if (error.response.data) console.error('External response DATA (preview):', typeof error.response.data === 'string' ? error.response.data.substring(0, 500) + '...' : error.response.data);

             // Re-throw or return a generic error if not specifically handled by status checks above
             return res.status(error.response.status || 500).json({ message: `Error interacting with external server: Status ${error.response.status || 'Unknown'}` });

        } else if (error.request) {
             // The request was made but no response was received (network issue, server down)
             console.error('No response received from external server:', error.request);
             return res.status(500).json({ message: 'Could not connect to the external login server.' });
        } else {
             // Something happened in setting up the request or in your code (e.g., encryption error, DB error)
             console.error('An internal error occurred:', error.message);
             // Log the error stack for more details on internal errors
             console.error('Error stack:', error.stack);
             return res.status(500).json({ message: `An internal server error occurred: ${error.message}` });
        }
    }
});

// This endpoint will return the authenticated user's profile data from your DB
// This route needs authentication middleware applied before it.
router.get('/profile',
		authenticateToken,
    async (req, res) => {
    // This route should be protected by your authentication middleware.
    // The middleware should verify the JWT from the Authorization header
    // and typically attach the decoded token payload (e.g., { userId: '...', ... }) to req.user.

    // Check if req.user is populated by the authentication middleware
    // Assuming the middleware puts the user's DB _id into req.user.userId
    if (!req.user || !req.user.userId) { // Check for userId as added to the token payload
        // This case should ideally be handled by the middleware itself by returning 401
        // but this check acts as a safeguard.
        return res.status(401).json({ message: 'Not authenticated or user information missing in token payload.' });
    }

    try {
        // Fetch the complete user document from the database using the _id from the token payload
        // Use req.user.userId which is the userId from the token payload ({ userId: user._id })
        const user = await User.findById(req.user.userId)
            .select('-password -studentId -__v'); // Exclude sensitive/internal fields from response

        if (!user) {
            // User ID from token not found in DB (shouldn't happen if DB is consistent)
             console.error('User ID from token not found in database:', req.user.userId);
             // This might indicate a user was deleted but a valid token still exists
             return res.status(404).json({ message: 'User not found in database.' });
         }

        // Return the user's profile data (excluding sensitive fields)
        res.status(200).json({
            message: 'User profile data',
            user: {
                _id: user._id,
                username: user.username, // External student ID
                displayName: user.displayName,
                credits: user.credits,
                points: user.points,
                addresses: user.addresses, // Include addresses if stored in User model
                createdAt: user.createdAt
                // Include other profile fields you want the frontend to have
            }
        });

    } catch (dbError) {
        console.error('Database error fetching user profile:', dbError);
        res.status(500).json({ message: 'Failed to fetch user profile.' });
    }
});

// --- Protected Endpoint to Update User Profile ---
router.put('/profile',
  authenticateToken,
  async (req, res) => {
    const userId = req.user.userId;
    const updates = req.body;

    // Define allowed update fields to prevent users from changing sensitive data
    // Make sure 'addresses' is included here
    const allowedUpdates = ['displayName', 'addresses']; // <<<< IMPORTANT: 'addresses' must be here

    const updatesToApply = {};
    Object.keys(updates).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        updatesToApply[key] = updates[key];
      } else {
        console.warn(`User ${userId} attempted to update disallowed field: ${key}`);
      }
    });

    if (Object.keys(updatesToApply).length === 0) {
      console.log(`No valid fields provided for update for user ${userId}.`);
      return res.status(200).json({ message: 'No valid fields provided for update.' });
    }

    try {
      const user = await User.findByIdAndUpdate(
        userId,
        { $set: updatesToApply }, // Use $set to update specific fields, including the entire addresses array
        {
          new: true,
          runValidators: true // Crucial: This ensures AddressSchema validators are run
        }
      ).select('-password -studentId -__v'); // Exclude sensitive/internal fields

      if (!user) {
        console.error('User not found in DB for update:', userId);
        return res.status(404).json({ message: 'User not found for update.' });
      }

      res.status(200).json({
        message: 'Profile updated successfully',
        user: {
          _id: user._id,
          username: user.username, // Assuming username is the studentId
          displayName: user.displayName,
          credits: user.credits,
          points: user.points,
          addresses: user.addresses, // Include updated addresses in the response
          createdAt: user.createdAt
        }
      });

    } catch (dbError) {
      console.error('Database error updating user profile:', dbError);
      if (dbError.name === 'ValidationError') {
        // Mongoose validation error for addresses subdocument
        return res.status(400).json({ message: dbError.message });
      }
      res.status(500).json({ message: 'Failed to update user profile.' });
    }
  }
);


// Export the router
module.exports = router;
