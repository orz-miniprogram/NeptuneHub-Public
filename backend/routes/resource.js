//routes/resource.js

const express = require('express');
const Resource = require('../models/Resource');
const auth = require('../middleware/auth');
const router = express.Router();
const upload = require('../utils/multerConfig'); // Import Multer upload instance
const isOutsidePeakPeriod = require('../utils/isOutsidePeakPeriod');
const { requestResourceRefund } = require('../controllers/refundController');

const { Queue } = require('bullmq');

// Configure Node.js Redis connection (must match the Python worker's Redis config)
const nodeRedisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
};

// Create a Node.js Queue instance
const pythonManagedQueue = new Queue('resource-processing', { // Same queue name as Python
  connection: nodeRedisConnection,
});


// --- ADD THE NEW FILE UPLOAD ROUTE ---
// POST /api/resource/upload-media
// This route expects a file with the field name 'media' (or whatever you set 'name' to in Taro.uploadFile)
router.post('/upload-media', auth, upload.single('media'), async (req, res) => { // 'media' is the field name
    try {
        // Multer adds the file information to req.file
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        console.log('File uploaded successfully:', req.file);

        // Construct the URL to access the uploaded file
        // This assumes your server serves static files from the 'uploads' directory
        // You'll need to configure Express to serve static files.
        // Example: If your backend runs on http://localhost:5000 and uploads is in backend root,
        // you might configure a static route like app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); in server.js
        const fileUrl = `/uploads/${req.file.filename}`; // Example URL path


        // You could save the file information to the database here if needed
        // Or just return the URL/path to the frontend

        res.status(200).json({ message: 'File uploaded successfully', filePath: fileUrl }); // Return the accessible path/URL

    } catch (error) {
        console.error('Error during file upload:', error);
        res.status(500).json({ message: 'Failed to upload file.' });
    }
});

// Base Route - Check API is working
router.get('/test', (req, res) => {
    res.json({ message: "Resource API is working!" });
});

router.get('/', async (req, res) => {
          try {
                    // Assuming authenticateToken middleware has already run and set req.user.userId
        // If this route can be accessed without a token, handle that case.
        // If it requires a token, use req.user.userId instead of query param for the owner filter
        const currentUserId = req.user?.userId; // Get the authenticated user's ID if middleware ran


                    const userIdQueryParam = req.query.userId; // Get userId from query param if needed for filtering by a specific user's resources
                    const status = req.query.status;

                    let filter = {};

                    // Apply filter by user ID if the current authenticated user ID is available
        // Or if a specific userId is provided in the query params AND is allowed
        if (currentUserId) {
            // Filter resources owned by the authenticated user
            filter.userId = currentUserId; // <<< Correct field name for filtering
        } else if (userIdQueryParam) {
            // If not authenticated, but a userId query param is provided,
            // you might allow fetching public resources for a specific user ID,
            // or you might return an error if this endpoint is meant to be protected.
             console.warn("Fetching resources filtered by userId query param without authentication.");
             filter.userId = userIdQueryParam; // <<< Correct field name for filtering
        }
        // If neither currentUserId nor userIdQueryParam is present, the filter is empty,
        // and the query will return all resources (potentially limited by status filter).


                    if (status && status !== 'all') {
                              filter.status = status;
                    } else if (status === 'all') {
            // If status is 'all', remove any default status filter
            // The filter is just filter.userId if present
         }
         else {
            // Default status filter if no status query param is provided
            // Assuming you don't want to show 'matched' resources by default unless explicitly requested
            filter.status = { $ne: 'matched' };
         }


                    // Fetch resources, filtering and populating the correct field
                    const resources = await Resource.find(filter).populate('userId'); // <<< Populate 'userId' instead of 'owner'
                    res.json(resources);
          } catch (err) {
                    console.error("Error fetching resources:", err); // Log the error details
                    res.status(500).json({ message: err.message || 'Failed to fetch resources.' }); // Return error message
          }
});

router.post('/',
  upload.array('media', 5),
  async (req, res) => {
    console.log("Backend - Received POST /api/resource request.");
    console.log("Backend - req.body:", req.body);

    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: 'Authentication failed or user not found.' });
    }
    const currentUserId = req.user._id;
    const { name, description, price, type, userSpecs } = req.body;

    if (!name || !type || !['buy', 'sell', 'rent', 'lease', 'service-request', 'service-offer'].includes(type)) {
      return res.status(400).json({ message: 'Name and a valid resource type are required.' });
    }

    let specifications = {};
    if (typeof userSpecs === 'string') {
      try {
        specifications = JSON.parse(userSpecs);
      } catch (err) {
        return res.status(400).json({ message: 'Invalid JSON format for specifications.' });
      }
    } else if (typeof userSpecs === 'object') {
      specifications = userSpecs;
    }

    // --- VALIDATION AND DATA EXTRACTION FOR 'lease' and 'rent' types ---
    if (['lease', 'rent'].includes(type)) {
      const {
        from_time,
        to_time,
        period_quantity,
        period_unit,
        base_rental_rate,
        base_rental_rate_unit,
        duration_input_mode,
        location_address // Extract location address for rent/lease
      } = specifications;

      // ... (your existing validation for lease/rent: from_time, duration, rates) ...

      // Validate location_address
      if (!location_address?.district) {
        return res.status(400).json({ message: 'For lease or rent resources, a valid location address with district is required in specifications.' });
      }
      specifications.location_address = location_address;
    }
    // --- END VALIDATION AND DATA EXTRACTION FOR 'lease' and 'rent' ---

    let resourcePrice;
    const isErrand = ['service-request', 'service-offer'].includes(type);

    if (isErrand) {
      // ... (your existing errand logic) ...
    } else {
      resourcePrice = price ? parseFloat(price) : undefined;
      if (!resourcePrice || isNaN(resourcePrice) || resourcePrice <= 0) {
        return res.status(400).json({ message: 'Price is required and must be positive for this resource type.' });
      }

      // --- EXTRACT ADDRESSES FOR 'buy' and 'sell' ---
      if (type === 'buy') {
        const { delivery_address } = specifications;
        if (!delivery_address?.district) {
          return res.status(400).json({ message: 'For buy requests, a valid delivery address with district is required in specifications.' });
        }
        specifications.delivery_address = delivery_address; // Keep it in specifications
      } else if (type === 'sell') {
        const { pickup_address } = specifications;
        if (!pickup_address?.district) {
          return res.status(400).json({ message: 'For sell requests, a valid pickup address with district is required in specifications.' });
        }
        specifications.pickup_address = pickup_address; // Keep it in specifications
      }
    }

    let resourceStatus;
    if (type === 'service-request') {
      resourceStatus = 'submitted';
    } else {
      resourceStatus = 'matching';
    }

    const resourceData = {
      name,
      description,
      price: resourcePrice,
      userId: currentUserId,
      type,
      status: resourceStatus,
      specifications, // Specifications now includes addresses for buy, sell, rent, lease
    };

    if (req.files && req.files.length > 0) {
      resourceData.media = req.files.map(file => file.filename || file.path);
    }

    try {
      const resource = new Resource(resourceData);
      await resource.save();

      res.status(201).json({
        message: 'Resource submitted successfully. Processing in background.',
        resourceId: resource._id,
        name: resource.name,
        status: resource.status,
        createdAt: resource.createdAt,
        type: resource.type,
      });

      // Queue classification job
      await pythonManagedQueue.add('classifyResource', {
        resourceId: resource._id.toString(),
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      });

      if (isErrand) {
        console.log(`Backend - Queuing 'populate_potential_matches' job for errand type: ${type}, Resource ID: ${resource._id}`);
        await pythonManagedQueue.add('populate_potential_matches', {
          resourceId: resource._id.toString(),
          resourceType: type,
        }, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          delay: 5000
        });
      }

    } catch (error) {
      if (error.name === 'ValidationError') {
        console.error('Backend - Mongoose Validation Error Details:', error.message, error.errors);
        const messages = Object.values(error.errors).map(val => val.message);
        return res.status(400).json({ message: `Validation Error: ${messages.join(', ')}` });
      }

      console.error("Backend - General error during initial resource save or job add:", error.message);
      res.status(500).json({ message: 'Failed to submit resource.' });
    }
  });

router.get('/:id',
    // Add authenticateToken middleware here if this endpoint is protected
    // authenticateToken,
    async (req, res) => {
    try {
        const resourceId = req.params.id;
        // If protected, check if the authenticated user is allowed to view this resource
        // const currentUserId = req.user.userId;

        // Find a resource by ID, potentially populate user details if needed
        const resource = await Resource.findById(resourceId)
           .populate('userId', 'username name');
           ;

        if (!resource) {
            return res.status(404).json({ message: 'Resource not found' });
        }

        // Add authorization check here if only the owner can edit/view details
        // if (resource.userId.toString() !== currentUserId) {
        //    return res.status(403).json({ message: 'Not authorized to view this resource' });
        // }


        res.status(200).json(resource); // Return the resource data
    } catch (err) {
        console.error(`Error fetching resource ${req.params.id}:`, err);
        if (err.kind === 'ObjectId') { // Check for invalid ObjectId (important!)
            return res.status(404).json({ message: 'Resource not found with invalid ID format.' });
        }
        res.status(500).json({ message: 'Server Error fetching resource.' });
    }
});

router.put('/:id',
         // upload.array('media', 5),
         async (req, res) => {
          try {
        console.log('Attempting to update resource status for ID:', req.params.id); // <<< Log 1

                    const resourceId = req.params.id;
                    const currentUserId = req.user.userId;

                    const updates = req.body;
                    const allowedUpdates = ['name', 'description', 'price', 'type', 'specifications', 'status', 'cancellationReason'];

                    const updatesToApply = {};
                    Object.keys(updates).forEach((key) => {
            if (allowedUpdates.includes(key)) {
                 if (key === 'specifications') {
                     updatesToApply.specifications = updates[key];
                 } else {
                     updatesToApply[key] = updates[key];
                 }
            } else {
                 console.warn(`User ${currentUserId} attempted to update disallowed field on resource ${resourceId}: ${key}`);
             }
                    });

        console.log('Updates to apply:', updatesToApply); // <<< Log 2

                    if (Object.keys(updatesToApply).length === 0) {
                              console.log(`No valid fields provided for update for resource ${resourceId}.`);
            // ... (handle 400 or add status) ...
             if (updates.status && !updatesToApply.status) {
                updatesToApply.status = updates.status;
             }
             // If still no updates, return 400 early
             if (Object.keys(updatesToApply).length === 0) {
                 return res.status(400).json({ message: 'No valid update fields provided.' });
             }
                    }

                    // Find the resource to check ownership before updating
                    const resource = await Resource.findById(resourceId);
                    if (!resource) {
                              console.warn(`Resource not found for update with ID: ${resourceId}`); // <<< Log for 404 check
                              return res.status(404).json({ message: 'Resource not found' });
                    }

                    // Authorization check: Ensure the authenticated user owns this resource
                    if (resource.userId.toString() !== currentUserId) {
                              console.warn(`User ${currentUserId} attempted to update resource ${resourceId} they do not own.`); // <<< Log for 403 check
                              return res.status(403).json({ message: 'Not authorized to update this resource' });
                    }

        console.log('Resource found and authorized for update.'); // <<< Log 3


                    // Apply the updates, handling status specific logic
                    if (updatesToApply.status) {
             // ... status transition logic ...
             if ((updatesToApply.status === 'canceled' || updatesToApply.status === 'declined') && !updatesToApply.cancellationReason && resource.cancellationReason === undefined) {
                  // ... cancellation reason check ...
             }
             console.log(`Resource ${resourceId} status changed to ${updatesToApply.status}.`); // <<< Your existing log
        }


                    // Update the resource in the database
                    const updatedResource = await Resource.findByIdAndUpdate(
                              resourceId,
                              { $set: updatesToApply },
                              { new: true, runValidators: true }
                    );

                    if (!updatedResource) {
                                  console.error('Resource not found in DB during findByIdAndUpdate:', resourceId); // <<< Log for post-update 404 check
                                  return res.status(404).json({ message: 'Resource not found during update.' });
                        }

        console.log('Database update successful. Attempting to send success response.'); // <<< Log 4

                    res.status(200).json({ message: 'Resource updated successfully', resource: updatedResource }); // <<< The response line

        console.log('Success response sent (or attempted).'); // <<< Log 5


          } catch (error) {
        console.error(`Error during resource update handler for ID ${req.params.id}:`, error); // <<< Log in catch block
                    if (error.name === 'ValidationError') {
                              return res.status(400).json({ message: `Validation Error: ${error.message}` });
                    }
                    if (error.kind === 'ObjectId') {
                                  return res.status(404).json({ message: 'Resource not found with invalid ID format for update.' });
                        }
                    res.status(500).json({ message: 'Failed to update resource.' });
          }
  });

// Route to initiate a refund request for a Resource
// PUT because we are updating the resource with a refundRequestId
router.put('/:id/refund', requestResourceRefund);

module.exports = router;
