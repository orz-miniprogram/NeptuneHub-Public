// ./pages/user/login/index.jsx

import React, { useState, useEffect, useRef } from 'react';
import { View, Input, Button, Text, Image } from '@tarojs/components'; // Import Image for icon
import Taro from '@tarojs/taro';
import './index.scss'; // Ensure you have styling for these elements
import { login } from '../../../utils/api'; 

const SignInPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false); // <<-- New state for password visibility
  const redirectUrlRef = useRef(null);
  
  useEffect(() => {
     console.log('useEffect running...'); // Log start of effect
     try { // Add a try-catch inside effect for extra safety
        const instance = Taro.getCurrentInstance();
        console.log('Taro instance:', instance); // Log the instance object

        const router = instance?.router; // Use optional chaining for safety
        console.log('Router object:', router); // Log the router object

        const params = router?.params; // Use optional chaining for safety
        console.log('Router params object:', params); // Log the params object

        if (params && params.redirectTo) {
          console.log('redirectTo param exists. Raw value:', params.redirectTo); // Log the raw param value
          const redirectUrl = decodeURIComponent(params.redirectTo); // Decode the value
          console.log('Decoded redirect URL:', redirectUrl); // Log the decoded URL
          redirectUrlRef.current = redirectUrl; // Store in ref
          console.log('Redirect URL stored in ref:', redirectUrlRef.current); // Log the ref's value
        } else {
            console.log('No redirectTo param found in router params.');
        }
        console.log('useEffect finished successfully.'); // Log successful end of effect
     } catch (e) {
        console.error('Error inside useEffect:', e); // Log any error occurring inside the effect
        console.error('Error stack inside useEffect:', e.stack); // Log stack if error occurs inside effect
     }
   }, []); // Empty dependency array


  // Function to toggle password visibility
  const handleToggleShowPassword = () => {
    setShowPassword(!showPassword); // Flip the boolean state
  };

  const handleLogin = async () => {
    // ... validation, setLoading, setError ...

    try {
      // Use the 'login' function from api.js
      const response = await login(username, password); // <<-- Use the wrapper function

      console.log('Backend response:', response);

      // The response handling for 200 success (storing token, showing toast, redirecting)
      // remains similar, as the 401/403/network error handling is now inside the wrapper's catch.
      if (response.statusCode === 200 && response.data && response.data.token) {
        const { token, user } = response.data;
        const userId = user?._id;

        Taro.setStorageSync('authToken', token); // Still store token here after success
        if (userId) {
           Taro.setStorageSync('userId', userId);
        }

        Taro.showToast({
          title: 'Login Successful',
          icon: 'success',
          duration: 1500,
        });

        setTimeout(() => {
           if (redirectUrlRef.current) {
               // Check if the redirect URL is a tabbar page
               const tabbarPages = ['/pages/index/index', '/pages/request/index', '/pages/activity/index', '/pages/orders/index', '/pages/user/index'];
               const isTabbarPage = tabbarPages.some(page => redirectUrlRef.current.startsWith(page));
               
               if (isTabbarPage) {
                   Taro.switchTab({ url: redirectUrlRef.current });
               } else {
                   Taro.navigateTo({ url: redirectUrlRef.current });
               }
           } else {
               Taro.switchTab({ url: '/pages/index/index' });
           }
         }, 1500);

      } else {
         // This else block will handle non-200 responses that are NOT 401/403/network errors
         // (e.g., 400 from your backend validation, or specific errors returned by the external site)
         const errorMessage = response.data && response.data.message ? response.data.message : 'Login failed. Please try again.';
         setError(errorMessage);
         Taro.showToast({
           title: errorMessage,
           icon: 'none',
           duration: 2000,
         });
      }

    } catch (err) {
      // The 'catch' block here will now catch errors re-thrown by the 'request' wrapper
      // (network errors, or 401/403/other errors handled and re-thrown inside the wrapper)
       console.error('Login request failed via wrapper:', err);
       // Error messages are handled inside the wrapper and shown via showToast
       // No need to show generic network error here unless you want extra handling
       setError('Login failed. Please check logs.'); // Or a more specific message
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className='sign-in-page'>
      <Text className='page-title'>Sign In</Text>

      {/* Username Input */}
      <View className='input-container'>
        <Input
          className='input-field'
          type='text'
          placeholder='Username or Email'
          value={username}
          onInput={(e) => setUsername(e.detail.value)}
          disabled={loading}
        />
      </View>

      {/* Password Input */}
      {/* Add a container to position the input and the eye icon */}
      <View className='input-container password-input-container'> {/* Added a class for specific styling */}
        <Input
          className='input-field password-input-field' // Added a class for specific styling
          // Dynamically set the input type based on showPassword state
          type={showPassword ? 'text' : 'password'} // <<-- Dynamic type
          placeholder='Password'
          value={password}
          onInput={(e) => setPassword(e.detail.value)}
          disabled={loading}
        />
        {/* Toggle button/icon for password visibility */}
        {/* You'll need to provide appropriate icons (e.g., eye icon and eye-slash icon) */}
        {/* Use absolute or flexbox styling in SCSS to position this button */}
        <View className='password-toggle-button' onClick={handleToggleShowPassword}> {/* Add a class for specific styling */}
           {/* Replace with your eye icon component or Image */}
           {/* Example using Text, ideally use Image with icon file */}
           <Text>{showPassword ? '🙈' : '👁️'}</Text> {/* Example icons, use actual image assets */}
           {/* Or use an Image component */}
           {/* <Image src={showPassword ? '/path/to/hide-icon.png' : '/path/to/show-icon.png'} className='password-toggle-icon' /> */}
        </View>
      </View>


      {/* Display Error Message */}
      {error && <Text className='error-message'>{error}</Text>}

      {/* Login Button */}
      <Button
        className='login-button'
        onClick={handleLogin}
        loading={loading}
        disabled={loading}
      >
        {loading ? 'Signing In...' : 'Sign In'}
      </Button>

      {/* Optional links */}
    </View>
  );
};

export default SignInPage;