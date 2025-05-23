// frontend/src/utils/api.js

import Taro from '@tarojs/taro';

// Define your backend API base URL (ensure this is correctly set)
// Assuming API_BASE_URL is defined via defineConstants in config/index.js
// If not, define it here: const API_BASE_URL = 'YOUR_BACKEND_API_URL';

console.log("API URL in api.js:", API_BASE_URL);


// *** REMOVE the Taro.addInterceptor block entirely from this file ***
// We are replacing the interceptor functionality with a wrapper function.


// Custom wrapper function for making authenticated API requests
const request = async (options) => {
  console.log('Custom Request Wrapper: Processing request to', options.url);

  // Get the authentication token from local storage
  const authToken = Taro.getStorageSync('authToken');

  // Ensure headers object exists in options
  options.header = options.header || {};

  // If a token exists, add it to the Authorization header
  if (authToken) {
    options.header['Authorization'] = `Bearer ${authToken}`; // Add the Authorization header
    console.log('Custom Request Wrapper: Added Authorization header.');
  }

  // Default Content-Type if not already set
  if (!options.header['Content-Type']) {
      options.header['Content-Type'] = 'application/json';
  }


  try {
    // Call Taro.request with the modified options
    const response = await Taro.request(options);

    console.log('Custom Request Wrapper: Received response status', response.statusCode);

    // *** Implement response handling logic here (similar to response interceptor) ***
    // Example: Handle 401 Unauthorized or 403 Forbidden errors
    if (response.statusCode === 401 || response.statusCode === 403) {
        console.warn('Custom Request Wrapper: Authentication failed or token expired. Clearing token.');
        Taro.removeStorageSync('authToken');
        Taro.removeStorageSync('userId'); // Clear user info too
        Taro.showToast({
            title: 'Please log in again',
            icon: 'none',
            duration: 2000
        });
        // You might want to redirect to the login page here
         Taro.redirectTo({ url: '/pages/user/login/index' }); // Adjust path
    }
    // ... add other response handling logic here (e.g., success checks, error parsing) ...


    // Return the response
    return response; // <<-- Return the response object

  } catch (err) {
      // *** Implement fail handling logic here (similar to fail interceptor) ***
      console.error('Custom Request Wrapper: Request failed', err);
       // You might want to show a network error message to the user
       Taro.showToast({
           title: 'Network Error',
           icon: 'none',
           duration: 2000
       });
      // Re-throw the error to let the calling code handle the failure
      throw err; // <<-- Re-throw the error
  }
};


// Define and export API functions using the custom 'request' wrapper
// Example:
export const login = (username, password) => {
  return request({
    url: API_BASE_URL + '/api/auth/external-login',
    method: 'POST',
    data: { username, password },
    // No need to manually add Authorization header here
  });
};

export const getProfile = () => {
  return request({
    url: API_BASE_URL + '/api/auth/profile',
    method: 'GET',
    // No need to manually add Authorization header here
  });
};

export const updateProfile = (data) => {
    return request({
        url: API_BASE_URL + '/api/auth/profile',
        method: 'PUT',
        data: data,
        // No need to manually add Authorization header here
    });
};


// Export the wrapper function itself if you want to use it directly in some cases
export { request };