// frontend/src/utils/request.js

import Taro from '@tarojs/taro';

// Assuming API_BASE_URL is accessible here (e.g., from process.env or a config file)
// If not, you might need to import it or pass it to this function
// const API_BASE_URL = process.env.API_BASE_URL; // Example


/**
 * Basic API request wrapper with authentication token handling.
 *
 * @param {object} options - Options for Taro.request, plus custom options.
 * @param {string} options.url - The API endpoint URL (should ideally be relative to API_BASE_URL or include it).
 * @param {string} [options.method='GET'] - HTTP method (GET, POST, PUT, DELETE, etc.).
 * @param {object} [options.data] - Request payload.
 * @param {object} [options.header] - Custom request headers.
 * @param {boolean} [options.requireAuth=true] - Whether to include the auth token. Set to false for public endpoints.
 * @returns {Promise<Taro.request.SuccessCallbackResult>} - A promise that resolves with the response.
 */
const request = async (options) => {
  const { url, method = 'GET', data, header, requireAuth = true, ...restOptions } = options;

  const fullUrl = url.startsWith('http') ? url : API_BASE_URL + url; // Handle if URL is already full

  const defaultHeader = {
    'Content-Type': 'application/json', // Default to JSON content type
    // Add other default headers if needed
  };

  const authHeader = {};
  if (requireAuth) {
    const authToken = Taro.getStorageSync('authToken');
    if (authToken) {
      authHeader['Authorization'] = `Bearer ${authToken}`; // Add auth token if available and required
    } else if (requireAuth) {
      // If auth is required but no token is found, you might want to handle this:
      console.warn(`Request to ${fullUrl} requires authentication, but no token found.`);
      // Option 1: Redirect to login
      // Taro.redirectTo({ url: '/pages/user/login/index' });
      // Option 2: Throw an error immediately
      throw new Error('Authentication required, no token found.');
      // Option 3: Just proceed with the request (backend will likely return 401/403)
    }
  }

  try {
    const response = await Taro.request({
      url: fullUrl,
      method: method,
      data: data,
      header: {
        ...defaultHeader, // Start with defaults
        ...header, // Allow overriding defaults with provided headers
        ...authHeader, // Add auth header last to ensure it's included if required
      },
      ...restOptions, // Include any other options passed to the wrapper (e.g., timeout, dataType)
    });

    // You can add centralized response handling here
    // For example, checking for 401/403 and redirecting to login
     if (response.statusCode === 401 || response.statusCode === 403) {
         console.warn(`Authentication failed for ${fullUrl}: Status ${response.statusCode}`);
         // Example: Clear token and redirect, assuming you have a centralized auth error handler
         // Taro.removeStorageSync('authToken');
         // Taro.removeStorageSync('userId');
         // Taro.redirectTo({ url: '/pages/user/login/index' });
         // You might want to throw a specific error that your components can catch
         // throw new Error('Authentication failed');
     }

    // For non-2xx status codes, Taro.request does NOT automatically reject the promise
    // You might want to throw an error here if the status is not in a success range (2xx)
     if (response.statusCode < 200 || response.statusCode >= 300) {
          console.error(`API request failed for ${fullUrl}: Status ${response.statusCode}`, response.data);
          // Throw an error that includes the response data for easier handling in components
          const error = new Error(`API request failed with status ${response.statusCode}`);
          error.statusCode = response.statusCode;
          error.data = response.data; // Attach the response body
          throw error; // This will be caught by the .catch() block in your components
      }

	console.log('Request wrapper about to return response:', response);
    return response; // Return the full response object on success (2xx)

  } catch (error) {
    console.error(`Error during API request to ${fullUrl}:`, error);
    // Re-throw the error so components can handle it
    throw error;
  }
};

export default request;