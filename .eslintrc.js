module.exports = {
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  extends: ['eslint:recommended', 'plugin:react/recommended', 'taro/react'], // Added 'taro/react'
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
    },
    ecmaVersion: 12,
    sourceType: 'module',
  },
  plugins: ['react'],
  rules: {
    // Add or override rules here
    'react/jsx-uses-react': 'off', // Added rule
    'react/react-in-jsx-scope': 'off', // Added rule
  },
  settings: {
    react: {
      version: 'detect',
    },
  },
};